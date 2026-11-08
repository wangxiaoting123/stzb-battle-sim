/**
 * 始计只有**前 4 回合**（用户 2026-10-20 报障 1：「始计是前四回合，但是第七回合还在施加」）。
 *
 * 官方：「战斗前 4 回合，自身行动时…」——①我军大营下一次攻击/策略伤害 +20%；②敌军兵力最多单体
 *   下一次造成的伤害 −30%；③自身受到攻击/策略伤害后于本回合内进入洞察。
 *
 * 根因：只有 `onActSegments(startRound:1,endRound:4)` 限了**效果**，二类指挥的**主段**仍每回合判定
 *   → 第 5 回合起照样打「发动【始计】」并锁目标（战报里第 7 回合的「发动【始计】！」就是这个）；
 *   ③ 的 `onHurt` 也没窗口 → 第 5~8 回合仍能进洞察。
 *
 * 口径（本测试钉死）：
 *  - 整次判定限 `actRounds:[1,2,3,4]`：窗口外**不发** `skill_trigger` / `skill_cast`、不施加任何状态；
 *  - `onHurt.endRound:4`：第 5 回合起受击不再进入洞察。
 */
import { describe, it, expect } from 'vitest';
import { Rng } from '../src/engine/rng';
import { applyDamage, triggerRoundCommandOnAct, type CombatContext } from '../src/engine/action';
import { SKILL_REGISTRY } from '../src/data/skills';
import type { BattleEvent, General, Position, Skill, Status, UnitState } from '../src/engine/types';

function gen(id: string, position: Position, extra: Partial<General> = {}): General {
  return {
    id,
    name: id,
    rarity: '5星',
    cost: 3,
    faction: '魏',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'archer',
    position,
    attack: 120,
    defense: 120,
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
    ...extra,
  };
}

function unit(g: General, side: 'my' | 'enemy'): UnitState {
  return {
    general: g,
    side,
    troops: g.maxTroops,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    preparations: [],
  };
}

function scene(round: number) {
  const carrier = unit(gen('u', '中军', { commandSkillIds: ['shiji'] }), 'my');
  carrier.actCount = round; // 模拟：第 round 回合 carrier 已行动 round 次（carrier fast 场景）
  const bigCamp = unit(gen('h', '大营'), 'my');
  const foes = [
    unit(gen('e1', '前锋'), 'enemy'),
    unit(gen('e2', '中军'), 'enemy'),
    unit(gen('e3', '大营'), 'enemy'),
  ];
  const ctx: CombatContext = {
    rng: new Rng(11),
    myTeam: [carrier, bigCamp],
    enemyTeam: foes,
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: round,
  };
  return { ctx, carrier, bigCamp, foes };
}

const shijiEvents = (ctx: CombatContext) =>
  ctx.events.filter((e) => 'skillId' in e && e.skillId === 'shiji');

const boostsOf = (u: UnitState) =>
  u.statuses.filter(
    (s): s is Extract<Status, { type: 'damage_boost' }> =>
      s.type === 'damage_boost' && s.sourceSkillId === 'shiji'
  );

describe('始计：前 4 回合窗口', () => {
  it('第 1~4 回合照常发动：+20% 给大营、−30% 给敌方兵力最多者', () => {
    for (const round of [1, 2, 3, 4]) {
      const { ctx, carrier, bigCamp, foes } = scene(round);
      triggerRoundCommandOnAct(ctx, carrier);
      expect(ctx.events.some((e) => e.type === 'skill_cast' && e.skillId === 'shiji')).toBe(true);
      expect(boostsOf(bigCamp)).toHaveLength(1);
      expect(boostsOf(bigCamp)[0].rate).toBeGreaterThan(0);
      const debuffed = foes.filter((f) => boostsOf(f).length > 0);
      expect(debuffed).toHaveLength(1);
      expect(boostsOf(debuffed[0])[0].rate).toBeLessThan(0);
    }
  });

  it('第 5 回合起整次跳过：不发 skill_trigger / skill_cast，也不施加任何状态', () => {
    for (const round of [5, 6, 7, 8]) {
      const { ctx, carrier, bigCamp, foes } = scene(round);
      triggerRoundCommandOnAct(ctx, carrier);
      expect(shijiEvents(ctx)).toHaveLength(0);
      expect(boostsOf(bigCamp)).toHaveLength(0);
      expect(foes.some((f) => boostsOf(f).length > 0)).toBe(false);
    }
  });

  it('洞察（onHurt）同样限前 4 回合：第 4 回合受击进洞察，第 5 回合不再进', () => {
    const inWindow = scene(4);
    applyDamage(inWindow.ctx, inWindow.carrier, 300, inWindow.foes[0], 'physical', 'skill');
    expect(inWindow.carrier.statuses.some((s) => s.type === 'insight')).toBe(true);

    const outWindow = scene(5);
    applyDamage(outWindow.ctx, outWindow.carrier, 300, outWindow.foes[0], 'physical', 'skill');
    expect(outWindow.carrier.statuses.some((s) => s.type === 'insight')).toBe(false);
  });
});
