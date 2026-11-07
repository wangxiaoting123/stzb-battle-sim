/**
 * 预设分享编解码（导入 / 导出）：把「我的预设」变成一段可复制的 JSON 文本，好友导入后变成自己的预设。
 *
 * 设计口径：
 * - 分享只带**可复现队伍**（`name` / `side` / `slots`），剥离本地字段（`id` / `no` / 时间戳）——
 *   导入时由 `presetStore.importPresets` 重新分配新 id / 编号，不覆盖对方既有预设。
 * - 编码成带 `app` / `v` 的包（envelope），导入侧据此识别来源，错贴别的内容给友好报错；
 *   同时兼容「裸数组 / 裸单条」两种简写（手改过 JSON 也能导）。
 * - 校验复用 `presetStore.normalizeSlot` / `normalizeName`（与存档读取同口径，防手改坏数据）。
 *
 * 本模块纯逻辑、无 DOM：存储与 UI 由 `presetPanel.ts` / `main.ts` 接线，便于单测。
 */
import { normalizeName, normalizeSlot, type ImportEntry, type TeamPreset, type TeamSide } from './presetStore';
import type { SlotState } from './teamEditor';

/** 分享包标记（导入侧据此识别是本站预设分享） */
export const SHARE_APP = 'stzb-battle-sim';
export const SHARE_VERSION = 1;

/** 把一组预设编码成分享 JSON（只留 name / side / slots，剥离本地字段） */
export function encodeShare(presets: TeamPreset[]): string {
  const entries = presets.map((p) => ({
    name: p.name,
    side: p.side,
    slots: p.slots,
  }));
  return JSON.stringify({ app: SHARE_APP, v: SHARE_VERSION, presets: entries }, null, 2);
}

/**
 * 解析分享 JSON → 校验后的导入条目。
 * 接受三种形态：envelope（`{ presets: [...] }`）/ 裸数组 / 裸单条。
 * 非法 JSON / 一条都解析不出 → 抛 `Error`（人话文案，UI 直接展示）。
 */
export function decodeShare(text: string): ImportEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('不是有效的 JSON，请确认复制完整');
  }
  const list = toEntries(data);
  if (list.length === 0) {
    throw new Error('没找到可导入的队伍（缺少 name / slots）');
  }
  return list;
}

/** 把任意解析结果拍平成 ImportEntry[]（逐条校验，坏条目静默丢弃） */
function toEntries(data: unknown): ImportEntry[] {
  let arr: unknown[] = [];
  if (Array.isArray(data)) {
    arr = data;
  } else if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.presets)) arr = o.presets;
    else arr = [data];
  }
  const out: ImportEntry[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const name = normalizeName(String(o.name ?? ''));
    if (!name) continue;
    const side: TeamSide = o.side === 'blue' ? 'blue' : 'red';
    const slotsRaw = Array.isArray(o.slots) ? o.slots : [];
    const slots: SlotState[] = [0, 1, 2].map((i) => normalizeSlot(slotsRaw[i]));
    out.push({ name, side, slots });
  }
  return out;
}
