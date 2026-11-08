/**
 * 「敌军行动后」监听契约（2026-10-18，卞夫人【俭仪蹈和】落地时建立）。
 *
 * `CommandSkill.afterEnemyAct`（types.ts）：施法者**锁定的敌军**每成功发动主动战法 / 打出普通攻击后，
 * 由存活施法者按 `chance`（走士气修正）判定一次；命中则使**该敌军自身**随机陷入 `statuses` 中的 1 种。
 *
 * 官方 / 包内口径（200852 → 子技能 210852）：敌军群体每次发动主动战法或普通攻击后 50% 几率（prob_max=50）
 * 使自身在下一回合随机陷入犹豫或怯战，前 3 回合窗口。全部为**机制契约断言**（直接调
 * `triggerAfterEnemyActWatch`），不依赖战法发动率 RNG 结果。
 */
import { describe, it, expect } from 'vitest';
import { triggerAfterEnemyActWatch } from '../src/engine/action';
import type { CombatContext } from '../src/engine/action';
import type { General, Skill, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';
import { SKILL_MECHANISMS } from '../src/data/mechanisms';

function general(id: string, patch: Partial<General> = {}): General {
  return {
    id,
    name: id,
    rarity: '5星',
    cost: 2,
    faction: '魏',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'cavalry',
    position: '前锋',
    attack: 100,
    defense: 100,
    strategy: 100,
    speed: 50,
    attackRange: 3,
    maxTroops: 10000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
    ...patch,
  };
}

function unit(id: string, side: 'my' | 'enemy', patch: Partial<General> = {}): UnitState {
  return {
    general: general(id, patch),
    side,
    troops: 10000,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    preparations: [],
  };
}

function ctxOf(my: UnitState[], enemy: UnitState[], seed = 1): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: my,
    enemyTeam: enemy,
    events: [],
    skills: new Map(),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

/** 造一个已锁定目标的卞夫人（一类指挥准备阶段登记：casterId + targets） */
function setup(opts: { locked?: boolean; morale?: number; casterAlive?: boolean } = {}) {
  const atk = unit('a', 'my');
  const other = unit('b', 'my');
  const holder = unit('h603', 'enemy', { commandSkillIds: ['jianyi_daohe'], morale: opts.morale ?? 100 });
  if (opts.casterAlive === false) holder.alive = false;
  const ctx = ctxOf([atk, other], [holder]);
  const skill = SKILL_REGISTRY['jianyi_daohe'] as Extract<Skill, { type: 'command' }>;
  ctx.skills.set('jianyi_daohe', skill);
  ctx.lockedCommands.push({
    skill,
    casterId: 'h603',
    targets: opts.locked === false ? [] : [atk],
    repeatTargets: undefined,
    currentRate: 1,
  } as unknown as CombatContext['lockedCommands'][number]);
  return { ctx, atk, other, holder, skill };
}

/** 固定判定结果 / 抽签结果（不消耗真实 RNG，断言与种子无关） */
function stubRng(ctx: CombatContext, success: boolean, pickIndex = 0): void {
  (ctx as unknown as { rng: Rng }).rng = {
    chance: () => success,
    int: () => pickIndex,
  } as unknown as Rng;
}

function triggerEvent(ctx: CombatContext) {
  const ev = ctx.events.find((e) => e.type === 'skill_trigger');
  return ev && ev.type === 'skill_trigger' ? ev : null;
}

describe('敌军行动后监听（afterEnemyAct）', () => {
  it('命中：对被监听敌军自身挂 statuses[抽中]（犹豫，duration 1，来源战法 = 俭仪蹈和）', () => {
    const { ctx, atk } = setup();
    stubRng(ctx, true, 0);
    triggerAfterEnemyActWatch(ctx, atk, 'active');

    const ev = triggerEvent(ctx);
    expect(ev?.skillId).toBe('jianyi_daohe');
    expect(ev?.rate).toBe(50); // 士气 100 无修正
    expect(ev?.baseRate).toBe(50);
    expect(ev?.targetId).toBe('a'); // 判定目标 = 行动者本人

    const st = atk.statuses.find((s) => s.type === 'hesitation');
    expect(st?.type).toBe('hesitation');
    expect(st && 'remaining' in st ? st.remaining : null).toBe(1);
    expect(st?.sourceSkillId).toBe('jianyi_daohe');
    expect(st?.sourceSkillType).toBe('command');
  });

  it('抽签第 2 项 → 怯战（犹豫 / 怯战随机其一）', () => {
    const { ctx, atk } = setup();
    stubRng(ctx, true, 1);
    triggerAfterEnemyActWatch(ctx, atk, 'basic');
    expect(atk.statuses.some((s) => s.type === 'cowardice')).toBe(true);
    expect(atk.statuses.some((s) => s.type === 'hesitation')).toBe(false);
  });

  it('士气修正：士气 120 → 当前生效几率 56%（50 × 1.12）', () => {
    const { ctx, atk } = setup({ morale: 120 });
    stubRng(ctx, false);
    triggerAfterEnemyActWatch(ctx, atk, 'active');
    const ev = triggerEvent(ctx);
    expect(ev?.rate).toBe(56);
    expect(ev?.baseRate).toBe(50);
    expect(ev?.morale).toBe(120);
    expect(atk.statuses.length).toBe(0); // 未命中不挂状态
  });

  it('窗口外（第 4 回合）不判定', () => {
    const { ctx, atk, holder } = setup();
    ctx.currentRound = 4;
    holder.actCount = 4; // 模拟：holder 已行动 4 次，超过 endRound=3 → 钩子停
    stubRng(ctx, true, 0);
    triggerAfterEnemyActWatch(ctx, atk, 'active');
    expect(triggerEvent(ctx)).toBeNull();
    expect(atk.statuses.length).toBe(0);
  });

  it('只监听**锁定目标**：未被锁定的友军行动不判定', () => {
    const { ctx, other } = setup();
    stubRng(ctx, true, 0);
    triggerAfterEnemyActWatch(ctx, other, 'active');
    expect(triggerEvent(ctx)).toBeNull();
    expect(other.statuses.length).toBe(0);
  });

  it('施法者阵亡后不再触发', () => {
    const { ctx, atk } = setup({ casterAlive: false });
    stubRng(ctx, true, 0);
    triggerAfterEnemyActWatch(ctx, atk, 'active');
    expect(triggerEvent(ctx)).toBeNull();
    expect(atk.statuses.length).toBe(0);
  });

  it('数据口径：50% / 前 3 回合 / 主动 + 普攻两个触发源 / 犹豫 + 怯战两种', () => {
    const skill = SKILL_REGISTRY['jianyi_daohe'] as Extract<Skill, { type: 'command' }>;
    expect(skill.phase).toBe('prep');
    expect(skill.type).toBe('command');
    expect(skill.range).toBe(5);
    expect(skill.targetMode).toBe('group');
    expect(skill.afterEnemyAct?.chance).toBe(0.5);
    expect(skill.afterEnemyAct?.startRound).toBe(1);
    expect(skill.afterEnemyAct?.endRound).toBe(3);
    expect(skill.afterEnemyAct?.kinds).toEqual(['active', 'basic']);
    expect(skill.afterEnemyAct?.statuses.map((s) => s.type)).toEqual(['hesitation', 'cowardice']);
    expect(SKILL_MECHANISMS['jianyi_daohe']).toEqual({ 201: 1, 203: 1, 702: 1, 752: 1 });
  });

  it('属性段：敌军攻击 / 谋略最高单体各 −100，持续 3 回合（无距离限定 pick）', () => {
    const skill = SKILL_REGISTRY['jianyi_daohe'] as Extract<Skill, { type: 'command' }>;
    const segs = (skill.initialOutput ?? []) as Array<{
      targetPick?: string;
      status?: { type: string; amount?: number; duration?: number };
    }>;
    expect(segs.length).toBe(2);
    expect(segs[0].targetPick).toBe('highest_attack_enemy');
    expect(segs[0].status).toMatchObject({ type: 'attack_buff', amount: -100, duration: 3 });
    expect(segs[1].targetPick).toBe('highest_strategy_enemy');
    expect(segs[1].status).toMatchObject({ type: 'strategy_buff', amount: -100, duration: 3 });
  });
});
