/**
 * 预设面板（顶栏「预设」）＋ 预设命名弹窗。
 *
 * 左列：搜索框（预设名 / 武将名 / #编号）+ **两个来源之间的切换**（用户 2026-11-05 口径：一次只看一组）：
 *   · 热门预设（内置固定层，删不掉、改不了，只能上场 / 另存为我的预设）
 *   · 我的预设（用户自己存的，编号升序，可上场 / 重命名 / 删除）
 * 切换器带各组条数，默认热门；搜索只作用于当前这一组。不注入内置层的老调用方隐藏切换器，只显示「我的预设」。
 * 右详情：三将配置明细（战法 / 兵种转换 + 兵系特性 / 宝物 + 词条 / 加点 / 红度 / 等级）+ 动作（按来源分档）。
 *
 * 面板只负责展示与转发：存档读写、配将区改动都由调用方（main.ts）注入，便于单测直接喂假数据。
 * 按钮一律走项目按键标准 `class="btn beige"`（见 styles.css「项目按键标准」），不用裸文字 .btn.ghost
 * —— 用户 2026-09-22：「所有的按键都为按钮，用按钮的统一 UI 设计」。
 */
import { PRESET_MAX, SIDE_LABEL, searchPresets, type ImportEntry, type TeamPreset, type TeamSide } from './presetStore';
import { hotVersion, isHotId } from './hotPresets';
import { getHeroById, avatarSrc, rednessStars, skillGrade } from './heroes';
import { SKILL_REGISTRY } from '../src/data/skills';
import { TREASURES_BY_ID, AFFIXES } from '../src/data/treasures';
import { SECONDARY_TROOPS } from '../src/engine/secondaryTroop';
import { openPresetUploadDialog, type PresetScanSaveInput } from './presetUpload';
import { encodeShare, decodeShare } from './presetShare';
import type { SlotState } from './teamEditor';

/** 面板动作结果：`error` 有值 = 失败（面板内提示），`presetId` = 新建/覆盖后的预设（自动选中） */
export interface PresetActionResult {
  error?: string;
  presetId?: string;
}

export interface PresetPanelDeps {
  /** 当前全部预设（编号升序） */
  getPresets: () => TeamPreset[];
  /** 内置热门预设（固定层，删不掉、改不了）；不提供 = 面板只显示「我的预设」 */
  getHotPresets?: () => TeamPreset[];
  /** 保存当前某边队伍；同边同名由实现方按「覆盖」处理 */
  saveCurrent: (side: TeamSide, name: string) => PresetActionResult;
  /**
   * 「另存为我的预设」：把一条内置热门复制成用户自己的预设（同边同名 = 覆盖）。
   * 与 `saveCurrent` 的区别只在槽位来源。不提供 = 不显示该动作。
   */
  saveAsMine?: (preset: TeamPreset, name: string) => PresetActionResult;
  /** 用预设替换该边队伍 */
  apply: (preset: TeamPreset, side: TeamSide) => void;
  /**
   * 木桩队伍：把这支预设的阵容设为伤害测试的「木桩队伍」并跳转实验室（实验室里可「切回侍卫」）。
   * 面板只转发；不提供则不显示该动作。
   */
  useAsDummy?: (preset: TeamPreset) => void;
  rename: (id: string, name: string) => PresetActionResult;
  remove: (id: string) => void;
  /**
   * 导入分享/备份的队伍（把 `ImportEntry[]` 落进「我的预设」并持久化）。
   * 返回 `error` = 失败（面板内提示）；`presetId` = 首条导入项（面板切到「我的预设」并选中）。
   * 不提供 = 不显示「导入」入口（老调用方 / 单测向后兼容）。
   */
  importPresets?: (entries: ImportEntry[]) => PresetActionResult;
  /**
   * 「上传图片」识图建预设（用户 2026-10-21）：把截图识别出的三槽直接写进「我的预设」。
   * 不提供 = 不显示该入口（老调用方 / 单测向后兼容）。
   */
  saveScanned?: (input: PresetScanSaveInput) => PresetActionResult;
  /** 木桩模式（从伤害测试实验室打开）：「设为木桩队伍」当主按钮，上场按钮退成米黄 beige */
  dummyMode?: boolean;
  /** 关闭面板（可选） */
  onClose?: () => void;
}

export interface PresetPanelHandle {
  close: () => void;
}

/** 左列当前看的是哪一组来源 */
type PresetTab = 'hot' | 'mine';

const TAB_LABEL: Record<PresetTab, string> = { hot: '热门预设', mine: '我的预设' };

const POS_LABEL = ['大营', '中军', '前锋'];
const FREE_LABEL: Array<[keyof SlotState['freePoints'], string]> = [
  ['attack', '攻击'],
  ['defense', '防御'],
  ['strategy', '谋略'],
  ['speed', '速度'],
];
const TYPE_NAME: Record<string, string> = { cavalry: '骑兵', infantry: '步兵', archer: '弓兵' };

/** 时间格式化：MM-DD HH:mm（列表与详情共用，测试可断言固定格式） */
export function fmtTime(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 槽位一行摘要（三将名，用「、」连接；空槽标「空缺」） */
export function slotsSummary(slots: SlotState[]): string {
  const names = slots.map((s) => (s.heroId ? getHeroById(s.heroId)?.name ?? s.heroId : '空缺'));
  const filled = names.filter((n) => n !== '空缺');
  return filled.length ? filled.join('、') : '空缺';
}

/** 战法名（主战法在左，其后装配战法；未实装的主战法回退到武将档案里的名字） */
function skillNames(slot: SlotState): Array<{ name: string; main: boolean; grade: string }> {
  const hero = slot.heroId ? getHeroById(slot.heroId) : undefined;
  const out: Array<{ name: string; main: boolean; grade: string }> = [];
  if (slot.heroId && hero?.mainSkillId) {
    const s = SKILL_REGISTRY[hero.mainSkillId];
    out.push({ name: s?.name ?? hero.mainSkillName ?? '（主战法）', main: true, grade: skillGrade(hero.mainSkillId) });
  }
  for (const id of slot.extraSkillIds) {
    const s = SKILL_REGISTRY[id];
    if (s) out.push({ name: s.name, main: false, grade: skillGrade(id) });
  }
  return out;
}

/** 加点摘要：只列非 0 项（如「谋略+20 速度+10」） */
function freePointsText(slot: SlotState): string {
  const parts = FREE_LABEL.filter(([k]) => slot.freePoints[k] > 0).map(([k, label]) => `${label}+${slot.freePoints[k]}`);
  return parts.length ? parts.join(' ') : '无加点';
}

/** 宝物摘要：名称 +（锻造词条 数值） */
function treasureText(slot: SlotState): string {
  const cur = slot.treasure;
  const t = cur ? TREASURES_BY_ID[cur.treasureId] : null;
  if (!cur || !t) return '未佩戴宝物';
  const affix = cur.affix ? AFFIXES[cur.affix.name] : null;
  const v = cur.affix && affix ? ` ${cur.affix.value}${affix.unit === 'percent' ? '%' : ''}` : '';
  return `${t.name}${cur.affix ? `（${cur.affix.name}${v}）` : '（未锻造）'}`;
}

/** 兵种摘要：二级兵种（+兵系家族）或基础兵种 */
function troopText(slot: SlotState, heroTroop: string | undefined): string {
  if (slot.secondaryTroop) {
    const d = SECONDARY_TROOPS[slot.secondaryTroop];
    const traits = (slot.secondaryTraits ?? []).filter(Boolean);
    return `${slot.secondaryTroop}（${d?.family ?? ''}${traits.length ? ` · 特性 ${traits.join('/')}` : ''}）`;
  }
  return TYPE_NAME[heroTroop ?? ''] ?? '—';
}

/** 单槽明细（空槽 → 一行占位）。导出给伤害测试实验室的「木桩队伍」面板复用（用户 2026-09-22）。 */
export function slotDetailHtml(slot: SlotState, i: number): string {
  const pos = POS_LABEL[i] ?? '';
  const hero = slot.heroId ? getHeroById(slot.heroId) : undefined;
  if (!slot.heroId || !hero) {
    return `<div class="pd-slot empty"><span class="pd-pos">${pos}</span><span class="pd-empty">空缺</span></div>`;
  }
  const skills = skillNames(slot);
  const skillHtml = skills.length
    ? skills
        .map((s) => `<span class="pd-skill${s.main ? ' main' : ''}" data-grade="${s.grade}" title="${s.main ? '主战法' : '装配战法'}">${s.name}</span>`)
        .join('')
    : `<span class="pd-skill none">无战法（主战法未实装）</span>`;
  return `<div class="pd-slot">
      <span class="pd-pos">${pos}</span>
      <img class="pd-av" src="${avatarSrc(hero.id)}" alt="" onerror="this.style.display='none'" />
      <div class="pd-slot-main">
        <div class="pd-hero-line">
          <span class="pd-hero-name">${hero.name}</span>
          <span class="pd-lv">Lv.${slot.level}</span>
          <span class="pd-red" title="红度 ${slot.redness}/5">${rednessStars(slot.redness)}</span>
          <span class="pd-troop">${troopText(slot, hero.troopType)}</span>
        </div>
        <div class="pd-skills">${skillHtml}</div>
        <div class="pd-meta">加点 ${freePointsText(slot)}<i>·</i>${treasureText(slot)}</div>
      </div>
    </div>`;
}

/**
 * 预设命名弹窗（每队「保存预设」按钮与管理面板的「保存红队/蓝队」共用）。
 * `onSubmit` 返回错误文案 → 弹窗保留并内联显示；返回 null → 关闭。
 */
export function openPresetNameDialog(opts: {
  title: string;
  hint?: string;
  initial?: string;
  placeholder?: string;
  confirmText?: string;
  onSubmit: (name: string) => string | null;
}): void {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  const modal = document.createElement('div');
  modal.className = 'modal preset-name-modal';
  modal.innerHTML = `
    <div class="m-head"><h3>${opts.title}</h3><span class="m-close">×</span></div>
    <div class="m-body">
      <div class="pn-hint">${opts.hint ?? '给这支队伍取个名字（如「双减魏智」「战磐魏智」），下次可直接上场'}</div>
      <input class="pn-input" type="text" maxlength="20" placeholder="${opts.placeholder ?? '预设名'}" />
      <div class="pn-error"></div>
    </div>
    <div class="m-foot">
      <button class="btn beige pn-cancel" type="button">取消</button>
      <button class="btn pn-ok" type="button">${opts.confirmText ?? '保存预设'}</button>
    </div>
  `;
  const input = modal.querySelector('.pn-input') as HTMLInputElement;
  const err = modal.querySelector('.pn-error') as HTMLElement;
  input.value = opts.initial ?? '';
  const close = (): void => mask.remove();
  const submit = (): void => {
    const message = opts.onSubmit(input.value);
    if (message) {
      err.textContent = message;
      input.focus();
      input.select();
      return;
    }
    close();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  input.addEventListener('input', () => {
    err.textContent = '';
  });
  (modal.querySelector('.pn-ok') as HTMLElement).addEventListener('click', submit);
  (modal.querySelector('.pn-cancel') as HTMLElement).addEventListener('click', close);
  (modal.querySelector('.m-close') as HTMLElement).addEventListener('click', close);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });
  mask.appendChild(modal);
  document.body.appendChild(mask);
  input.focus();
}

/** 下载一段文本为 .json 文件 */
function downloadText(filename: string, text: string): void {
  // 安卓原生壳：走 JS 桥写进下载目录（WebView 的 <a download> 没有 DownloadListener 不会触发下载）
  const bridge = (globalThis as { StzbNative?: { saveTextFile?: (f: string, c: string) => void } }).StzbNative;
  if (bridge?.saveTextFile) {
    bridge.saveTextFile(filename, text);
    return;
  }
  // 网页版：浏览器原生下载
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 复制文本：优先 clipboard API，失败回退「选中 + execCommand」 */
async function copyText(text: string, ta: HTMLTextAreaElement): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    ta.focus();
    ta.select();
    return document.execCommand('copy');
  } catch {
    return false;
  }
}

/** 导出弹窗：展示分享 JSON，可复制 / 下载 .json */
function openShareDialog(opts: { title: string; json: string; filename: string; hint?: string }): void {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  const modal = document.createElement('div');
  modal.className = 'modal share-modal';
  modal.innerHTML = `
    <div class="m-head"><h3>${opts.title}</h3><span class="m-close">×</span></div>
    <div class="m-body">
      <div class="share-hint">${opts.hint ?? '把下面这段 JSON 发给好友，好友在「预设」面板点「导入」粘贴即可'}</div>
      <textarea class="share-text" readonly spellcheck="false"></textarea>
      <div class="share-msg"></div>
    </div>
    <div class="m-foot">
      <button class="btn beige share-copy" type="button">复制</button>
      <button class="btn beige share-download" type="button">下载 .json</button>
      <button class="btn share-done" type="button">完成</button>
    </div>
  `;
  const ta = modal.querySelector('.share-text') as HTMLTextAreaElement;
  const msg = modal.querySelector('.share-msg') as HTMLElement;
  ta.value = opts.json;
  const close = (): void => mask.remove();
  modal.querySelector('.share-copy')!.addEventListener('click', () => {
    void copyText(opts.json, ta).then((ok) => {
      msg.textContent = ok ? '已复制到剪贴板' : '复制失败，请手动全选复制';
    });
  });
  modal.querySelector('.share-download')!.addEventListener('click', () => downloadText(opts.filename, opts.json));
  modal.querySelector('.share-done')!.addEventListener('click', close);
  modal.querySelector('.m-close')!.addEventListener('click', close);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });
  mask.appendChild(modal);
  document.body.appendChild(mask);
}

/** 导入弹窗：粘贴 JSON 或选 .json 文件 → 解析校验 → 落库 */
function openImportDialog(opts: {
  importPresets: (entries: ImportEntry[]) => PresetActionResult;
  onImported: (presetId?: string) => void;
}): void {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  const modal = document.createElement('div');
  modal.className = 'modal import-modal';
  modal.innerHTML = `
    <div class="m-head"><h3>导入预设</h3><span class="m-close">×</span></div>
    <div class="m-body">
      <div class="share-hint">粘贴好友发来的预设 JSON，或选择 .json 文件</div>
      <textarea class="share-text import-text" placeholder="粘贴 JSON 文本…" spellcheck="false"></textarea>
      <input type="file" class="import-file" accept=".json,application/json" hidden />
      <div class="share-msg"></div>
    </div>
    <div class="m-foot">
      <button class="btn beige import-choose" type="button">选择文件</button>
      <span class="spacer"></span>
      <button class="btn beige import-cancel" type="button">取消</button>
      <button class="btn import-ok" type="button">导入</button>
    </div>
  `;
  const ta = modal.querySelector('.import-text') as HTMLTextAreaElement;
  const fileInput = modal.querySelector('.import-file') as HTMLInputElement;
  const msg = modal.querySelector('.share-msg') as HTMLElement;
  const close = (): void => mask.remove();

  const doImport = (): void => {
    const text = ta.value.trim();
    if (!text) {
      msg.textContent = '先粘贴 JSON 或选择文件';
      return;
    }
    let entries: ImportEntry[];
    try {
      entries = decodeShare(text);
    } catch (e) {
      msg.textContent = (e as Error).message;
      return;
    }
    const r = opts.importPresets(entries);
    if (r.error) {
      msg.textContent = r.error;
      return;
    }
    close();
    opts.onImported(r.presetId);
  };

  modal.querySelector('.import-choose')!.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    f.text()
      .then((t) => {
        ta.value = t;
        msg.textContent = '';
      })
      .catch(() => {
        msg.textContent = '读文件失败';
      });
  });
  modal.querySelector('.import-ok')!.addEventListener('click', doImport);
  modal.querySelector('.import-cancel')!.addEventListener('click', close);
  modal.querySelector('.m-close')!.addEventListener('click', close);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });
  mask.appendChild(modal);
  document.body.appendChild(mask);
  ta.focus();
}

/**
 * 打开阵容预设面板。列表与详情都从 `deps.getPresets()` 现取现渲染——
 * 存档变更后不必重建面板，重新渲染即可。
 */
export function openPresetPanel(deps: PresetPanelDeps): PresetPanelHandle {
  let query = '';
  let selectedId: string | null = null;
  let armedDelete = false;
  /** 当前看的那一组：默认热门；没有内置层 / 热门为空时落到「我的预设」 */
  let tab: PresetTab = (deps.getHotPresets?.() ?? []).length ? 'hot' : 'mine';

  const mask = document.createElement('div');
  mask.className = 'modal-mask page-mask';
  const modal = document.createElement('div');
  modal.className = 'modal page-modal preset-modal';
  // 「上传图片」入口在标题行右端（× 左边，用户 2026-10-21 在截图上标注的位置）
  const uploadBtn = deps.saveScanned
    ? '<button class="btn beige preset-upload" type="button" title="上传游戏「阵容详情」截图，自动识别三将 / 红度 / 战法，确认后存进「我的预设」">上传图片</button>'
    : '';
  // 导入（粘贴/选择分享 JSON）；不注入 importPresets 的老调用方不显示该入口
  const importBtn = deps.importPresets
    ? '<button class="btn beige preset-import" type="button" title="粘贴好友分享的预设 JSON，导入成自己的预设">导入</button>'
    : '';
  modal.innerHTML = `
    <div class="m-head">
      <h3>预设</h3>
      <input class="preset-search" type="text" placeholder="搜索预设名 / 武将名 / #编号…" />
      ${uploadBtn}
      <span class="m-close">×</span>
    </div>
    <div class="m-body preset-body">
      <div class="preset-col">
        <div class="preset-tabs" role="tablist" aria-label="预设来源"></div>
        <div class="preset-list"></div>
      </div>
      <div class="preset-detail"></div>
    </div>
    <div class="m-foot preset-foot">
      <span class="preset-count"></span>
      <button class="btn beige preset-export-all" type="button" title="把「我的预设」全部导出成一份 JSON（备份 / 换设备迁移）">导出全部</button>
      ${importBtn}
      <span class="spacer"></span>
      <button class="btn beige preset-save" data-side="red" type="button">保存红队</button>
      <button class="btn beige preset-save" data-side="blue" type="button">保存蓝队</button>
      <button class="btn beige preset-done" type="button">完成</button>
    </div>
  `;
  const tabsBar = modal.querySelector('.preset-tabs') as HTMLElement;
  const listBox = modal.querySelector('.preset-list') as HTMLElement;
  const detailBox = modal.querySelector('.preset-detail') as HTMLElement;
  const countBox = modal.querySelector('.preset-count') as HTMLElement;
  const search = modal.querySelector('.preset-search') as HTMLInputElement;

  const heroNameOf = (id: string): string => getHeroById(id)?.name ?? '';

  /** 内置热门（固定层）；未注入 = 空 */
  const hots = (): TeamPreset[] => deps.getHotPresets?.() ?? [];

  /** 一条列表项：热门 = 金色「热门」标签 + 内置说明；我的 = #编号 + 更新时间 */
  const presetItem = (p: TeamPreset): HTMLElement => {
    const hot = isHotId(p.id);
    const item = document.createElement('div');
    item.className = `preset-item${p.id === selectedId ? ' on' : ''}`;
    item.dataset.presetId = p.id;
    item.dataset.no = String(p.no);
    item.innerHTML = `
        ${hot ? '<span class="pi-tag hot">热门</span>' : `<span class="pi-no">#${p.no}</span>`}
        <div class="pi-main">
          <div class="pi-head">
            <span class="pi-name" title="${p.name}">${p.name}</span>
            <span class="pi-side ${p.side}">${SIDE_LABEL[p.side]}</span>
          </div>
          <div class="pi-heroes">${slotsSummary(p.slots)}</div>
          <div class="pi-time">${hot ? '内置 · 不可编辑' : fmtTime(p.updatedAt)}</div>
        </div>
      `;
    item.onclick = () => {
      selectedId = p.id;
      armedDelete = false;
      renderList();
      renderDetail();
    };
    return item;
  };

  /** 左上切换器：两组各一个页签（带各组条数）；老调用方没注入内置层 → 整条隐藏 */
  const renderTabs = (): void => {
    if (!deps.getHotPresets) {
      tabsBar.hidden = true;
      tabsBar.innerHTML = '';
      return;
    }
    tabsBar.hidden = false;
    const counts: Record<PresetTab, number> = { hot: hots().length, mine: deps.getPresets().length };
    tabsBar.innerHTML = '';
    for (const key of ['hot', 'mine'] as PresetTab[]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `preset-tab${tab === key ? ' on' : ''}`;
      btn.dataset.tab = key;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(tab === key));
      btn.innerHTML = `${TAB_LABEL[key]}<span class="pt-n">${counts[key]}</span>`;
      btn.addEventListener('click', () => {
        if (tab === key) return;
        tab = key;
        armedDelete = false;
        renderList();
        renderDetail();
      });
      tabsBar.appendChild(btn);
    }
  };

  /** 空态：分「搜不到」与「这一组本来就空」两种，按组给下一步 */
  const emptyHtml = (poolSize: number, filtered: boolean): string => {
    if (filtered && poolSize > 0) {
      const other = tab === 'hot' ? '「我的预设」' : '「热门预设」';
      return `<div class="preset-empty">没有匹配「${query.trim()}」的预设<br /><span>换个关键词，或切到${other}看看</span></div>`;
    }
    if (tab === 'hot') {
      return `<div class="preset-empty">热门预设暂时是空的<br /><span>切到「我的预设」看看自己存的队伍</span></div>`;
    }
    return `<div class="preset-empty">还没有自己的预设<br /><span>配置好一边队伍后，点该队标题行的「保存预设」，或用右下角「保存红队 / 保存蓝队」；也可以从「热门预设」里「另存为我的预设」</span></div>`;
  };

  /**
   * 只渲染当前这一组（切换器已写明组名与条数，列表里不再重复分组标题）：
   * 选中项若不在本组 → 清空并落到本组第一条；搜索只作用于本组。
   */
  const renderList = (): void => {
    const hotAll = hots();
    const mineAll = deps.getPresets();
    if (!deps.getHotPresets) tab = 'mine';
    const pool = tab === 'hot' ? hotAll : mineAll;
    const list = searchPresets(pool, query, heroNameOf);
    if (selectedId && !list.some((p) => p.id === selectedId)) selectedId = null;
    if (!selectedId && list.length) selectedId = list[0].id;

    renderTabs();

    const filtered = query.trim().length > 0;
    countBox.textContent = filtered
      ? `筛选出 ${list.length} / ${pool.length} 条`
      : tab === 'hot'
        ? `热门预设 ${hotAll.length} 条`
        : `我的预设 ${mineAll.length} / ${PRESET_MAX} 条`;

    listBox.innerHTML = '';
    if (list.length === 0) {
      listBox.innerHTML = emptyHtml(pool.length, filtered);
      return;
    }
    for (const p of list) listBox.appendChild(presetItem(p));
  };

  const renderDetail = (): void => {
    const preset = [...hots(), ...deps.getPresets()].find((p) => p.id === selectedId);
    detailBox.innerHTML = '';
    if (!preset) {
      detailBox.innerHTML = `<div class="hist-empty">${
        tab === 'hot' ? '从左侧选一支热门队伍查看详情' : '从左侧选一条自己的预设查看详情'
      }</div>`;
      return;
    }
    const hot = isHotId(preset.id);
    const head = document.createElement('div');
    head.className = 'pd-head';
    head.innerHTML = `
      ${hot ? '<span class="pi-tag hot">热门</span>' : `<span class="pi-no">#${preset.no}</span>`}
      <span class="pd-title">${preset.name}</span>
      <span class="pi-side ${preset.side}">${SIDE_LABEL[preset.side]}</span>
      <span class="pd-time">${
        hot
          ? `内置热门预设 · 版本 ${hotVersion()}`
          : `保存 ${fmtTime(preset.createdAt)}${preset.updatedAt !== preset.createdAt ? ` · 更新 ${fmtTime(preset.updatedAt)}` : ''}`
      }</span>
    `;
    const slots = document.createElement('div');
    slots.className = 'pd-slots';
    slots.innerHTML = preset.slots.map((s, i) => slotDetailHtml(s, i)).join('');
    const actions = document.createElement('div');
    actions.className = 'pd-actions';
    // 木桩模式（从实验室打开）＝「设为木桩队伍」当主按钮（金色 btn），上场按钮退成米黄 beige（用户 2026-09-22 按键标准）
    const primaryApply = (side: TeamSide): string => (preset.side === side && !deps.dummyMode ? '' : ' beige');
    const dummyBtn = deps.useAsDummy
      ? `<button class="btn${deps.dummyMode ? '' : ' beige'}" data-act="dummy" type="button" title="把这支队伍设为伤害测试的木桩对手，并直接进入伤害测试实验室（可随时「切回侍卫」）">设为木桩队伍</button>`
      : '';
    // 内置热门是固定层：只能上场 / 设为木桩 / 另存为我的预设，不提供改名与删除（用户 2026-10-16 口径）
    const copyBtn =
      hot && deps.saveAsMine
        ? `<button class="btn beige" data-act="copy" type="button" title="把这支热门队伍复制成你自己的预设，之后可自由修改">另存为我的预设</button>`
        : '';
    const editBtns = hot
      ? ''
      : `
      <button class="btn beige" data-act="rename" type="button">重命名</button>
      <button class="btn beige danger" data-act="remove" type="button">${armedDelete ? '再点一次确认删除' : '删除'}</button>
    `;
    const exportBtn = `<button class="btn beige" data-act="export" type="button" title="把这支队伍导出成 JSON 分享给好友">导出</button>`;
    actions.innerHTML = `
      <button class="btn${primaryApply('red')}" data-act="apply-red" type="button">上场到红队</button>
      <button class="btn${primaryApply('blue')}" data-act="apply-blue" type="button">上场到蓝队</button>
      ${dummyBtn}
      ${copyBtn}
      ${exportBtn}
      ${editBtns}
    `;
    // 上场 = 整边替换 + 关面板（「快速上场」的主路径）
    actions.querySelector('[data-act="apply-red"]')!.addEventListener('click', () => {
      deps.apply(preset, 'red');
      close();
    });
    actions.querySelector('[data-act="apply-blue"]')!.addEventListener('click', () => {
      deps.apply(preset, 'blue');
      close();
    });
    // 木桩队伍：设为伤害测试的敌方并直接进实验室（与「上场」同口径：动作后关面板）
    actions.querySelector('[data-act="dummy"]')?.addEventListener('click', () => {
      deps.useAsDummy!(preset);
      close();
    });
    // 导出：把当前选中预设（热门或我的）编码成分享 JSON，弹窗里复制 / 下载
    actions.querySelector('[data-act="export"]')?.addEventListener('click', () => {
      openShareDialog({
        title: `导出预设 · ${preset.name}`,
        json: encodeShare([preset]),
        filename: `stzb-preset-${preset.name}.json`,
      });
    });
    // 另存为我的预设：内置条目 → 用户存档（同边同名 = 覆盖；落存档后就是可编辑的自己的预设）
    actions.querySelector('[data-act="copy"]')?.addEventListener('click', () => {
      openPresetNameDialog({
        title: '另存为我的预设',
        hint: `把热门预设「${preset.name}」复制成你自己的预设，之后可自由修改（同边同名会覆盖旧预设）`,
        initial: preset.name,
        placeholder: '我的预设名',
        confirmText: '存为我的预设',
        onSubmit: (name) => {
          const r = deps.saveAsMine!(preset, name);
          if (r.error) return r.error;
          if (r.presetId) {
            selectedId = r.presetId;
            tab = 'mine'; // 复制出来的条目落在「我的预设」，留在热门组会看不到它
          }
          renderList();
          renderDetail();
          return null;
        },
      });
    });
    actions.querySelector('[data-act="rename"]')?.addEventListener('click', () => {
      openPresetNameDialog({
        title: `重命名预设 #${preset.no}`,
        hint: `当前名称「${preset.name}」`,
        initial: preset.name,
        confirmText: '保存名称',
        onSubmit: (name) => {
          const r = deps.rename(preset.id, name);
          if (r.error) return r.error;
          renderList();
          renderDetail();
          return null;
        },
      });
    });
    actions.querySelector('[data-act="remove"]')?.addEventListener('click', () => {
      if (!armedDelete) {
        armedDelete = true;
        renderDetail();
        return;
      }
      armedDelete = false;
      if (selectedId === preset.id) selectedId = null;
      deps.remove(preset.id);
      renderList();
      renderDetail();
    });
    detailBox.append(head, slots, actions);
  };

  search.addEventListener('input', () => {
    query = search.value;
    armedDelete = false;
    renderList();
    renderDetail();
  });
  // 上传图片 → 识图建预设：落库成功后刷新列表并选中新条目（用户 2026-10-21）
  modal.querySelector('.preset-upload')?.addEventListener('click', () => {
    if (!deps.saveScanned) return;
    openPresetUploadDialog({
      save: deps.saveScanned,
      defaultSide: 'red',
      onSaved: (presetId) => {
        armedDelete = false;
        if (presetId) {
          selectedId = presetId;
          tab = 'mine'; // 识图结果存进「我的预设」，直接切过去看刚认出来的那一条
        }
        renderList();
        renderDetail();
      },
    });
  });
  modal.querySelectorAll<HTMLElement>('.preset-save').forEach((btn) => {
    btn.addEventListener('click', () => {
      const side = (btn.dataset.side === 'blue' ? 'blue' : 'red') as TeamSide;
      openPresetNameDialog({
        title: `保存预设 · ${SIDE_LABEL[side]}`,
        hint: `把当前${SIDE_LABEL[side]}的三将配置（战法 / 兵种 / 宝物 / 加点）存为预设，下次一键上场`,
        placeholder: '如：双减魏智',
        onSubmit: (name) => {
          const r = deps.saveCurrent(side, name);
          if (r.error) return r.error;
          if (r.presetId) {
            selectedId = r.presetId;
            tab = 'mine'; // 新存的预设一定在「我的预设」：切过去并选中，省得用户自己在两组间找
          }
          renderList();
          renderDetail();
          return null;
        },
      });
    });
  });

  // 导入：粘贴 / 选择文件 → 解析校验 → 落库 → 切到「我的预设」并选中首条
  modal.querySelector('.preset-import')?.addEventListener('click', () => {
    if (!deps.importPresets) return;
    openImportDialog({
      importPresets: deps.importPresets,
      onImported: (presetId) => {
        armedDelete = false;
        if (presetId) {
          selectedId = presetId;
          tab = 'mine'; // 导入的条目一定在「我的预设」
        }
        renderList();
        renderDetail();
      },
    });
  });
  // 导出全部：把「我的预设」整体编码成一份 JSON 备份
  modal.querySelector('.preset-export-all')?.addEventListener('click', () => {
    const all = deps.getPresets();
    openShareDialog({
      title: '导出全部预设',
      json: encodeShare(all),
      filename: `stzb-presets-${new Date().toISOString().slice(0, 10)}.json`,
      hint: all.length ? `共 ${all.length} 条，可复制发给好友或下载备份` : '还没有自己的预设，先保存几条再导出',
    });
  });

  const close = (): void => {
    mask.remove();
    deps.onClose?.();
  };
  (modal.querySelector('.m-close') as HTMLElement).addEventListener('click', close);
  (modal.querySelector('.preset-done') as HTMLElement).addEventListener('click', close);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });
  mask.appendChild(modal);
  document.body.appendChild(mask);
  renderList();
  renderDetail();
  return { close };
}
