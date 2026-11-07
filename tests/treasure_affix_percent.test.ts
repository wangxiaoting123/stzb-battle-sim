/**
 * 锻造词条「属性提升」量纲回归：骁锐/天资/稳固 官方为百分比（#5%~15%# / #10%~20%#），
 * 引擎须产出 `percent: true` 的 buff；灵动（速度）官方为点数（#10~30#），维持无 percent。
 * 起因：天资等锻造词条曾被 `MECHANICS` 按点数结算（UI 显示 %、引擎加点数）。
 */
import { describe, it, expect } from 'vitest';
import { buildTreasureStatuses } from '../src/engine/treasure';
import type { CreateStatus, General, TreasureLoadout } from '../src/engine/types';

const general = (): General => ({
  id: 'x', name: 'x', rarity: '5星', cost: 3, faction: '魏', tags: [],
  mutualExclusionGroup: null, troopType: 'cavalry', position: '大营',
  attack: 100, defense: 100, strategy: 100, speed: 50, attackRange: 3, maxTroops: 10000,
  mainSkillName: '', skillDesc: '', activeSkillIds: [], passiveSkillIds: [],
  commandSkillIds: [], pursuitSkillIds: [], morale: 100,
});

/** 只取锻造词条产出的状态（sourceId 含 `affix:`），剥离自带特效 */
const affixStatuses = (name: string, value: number): CreateStatus[] => {
  const loadout: TreasureLoadout = { treasureId: 1057, affix: { name, value } };
  return buildTreasureStatuses(loadout, general(), [])
    .filter((x) => x.sourceId.includes('affix:'))
    .map((x) => x.create);
};

describe('锻造词条属性提升量纲', () => {
  it('天资（谋略）→ strategy_buff 百分比', () => {
    const [s] = affixStatuses('天资', 15);
    expect(s).toMatchObject({ type: 'strategy_buff', amount: 15, percent: true });
  });

  it('骁锐（攻击）→ attack_buff 百分比', () => {
    const [s] = affixStatuses('骁锐', 15);
    expect(s).toMatchObject({ type: 'attack_buff', amount: 15, percent: true });
  });

  it('稳固（防御）→ defense_buff 百分比', () => {
    const [s] = affixStatuses('稳固', 20);
    expect(s).toMatchObject({ type: 'defense_buff', amount: 20, percent: true });
  });

  it('灵动（速度）→ speed_buff 点数（无 percent）', () => {
    const [s] = affixStatuses('灵动', 30);
    expect(s).toMatchObject({ type: 'speed_buff', amount: 30 });
    expect('percent' in s).toBe(false);
  });
});
