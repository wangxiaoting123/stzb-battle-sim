/** @vitest-environment jsdom */
/**
 * 预设分享 / 导入导出（数据层）：编解码往返、剥离本地字段、三种输入形态兼容、
 * 导入分配新 id/编号、同边同名避让。UI 侧接线见 presetPanel（导出/导入弹窗）。
 */
import { describe, expect, it } from 'vitest';
import { encodeShare, decodeShare } from '../web/presetShare';
import { importPresets, type TeamPreset, type TeamSide } from '../web/presetStore';
import type { SlotState } from '../web/teamEditor';

const slot = (heroId: string | null): SlotState => ({
  heroId,
  extraSkillIds: [],
  freePoints: { attack: 0, defense: 0, strategy: 0, speed: 0 },
  redness: 0,
  level: 40,
  treasure: null,
});

const preset = (id: string, name: string, no: number, side: TeamSide = 'red'): TeamPreset => ({
  id,
  no,
  name,
  side,
  slots: [slot('h1'), slot('h2'), slot('h3')],
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
});

describe('presetShare 编解码', () => {
  it('encode → decode 往返，保留 name / side / slots', () => {
    const json = encodeShare([preset('p_1', '双减魏智', 1)]);
    const entries = decodeShare(json);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('双减魏智');
    expect(entries[0].side).toBe('red');
    expect(entries[0].slots.map((s) => s.heroId)).toEqual(['h1', 'h2', 'h3']);
  });

  it('编码剥离本地字段（无 id / no / 时间戳）', () => {
    const json = encodeShare([preset('p_1', '队', 1)]);
    const parsed = JSON.parse(json) as { presets: Array<Record<string, unknown>> };
    expect(parsed.presets[0].id).toBeUndefined();
    expect(parsed.presets[0].no).toBeUndefined();
    expect(parsed.presets[0].createdAt).toBeUndefined();
    expect(parsed.presets[0].updatedAt).toBeUndefined();
  });

  it('接受裸数组 / 裸单条两种简写', () => {
    const entry = { name: '单条', side: 'red', slots: [slot('h1'), slot(null), slot(null)] };
    expect(decodeShare(JSON.stringify([entry]))).toHaveLength(1);
    expect(decodeShare(JSON.stringify(entry))).toHaveLength(1);
  });

  it('非法 JSON / 空条目抛人话错误', () => {
    expect(() => decodeShare('not json')).toThrow('不是有效的 JSON');
    expect(() => decodeShare('{}')).toThrow('没找到可导入的队伍');
    expect(() => decodeShare('[]')).toThrow('没找到可导入的队伍');
  });
});

describe('importPresets 合并', () => {
  it('分配新 id / 编号，不覆盖既有', () => {
    const base = { maxNo: 1, list: [preset('p_1', '我的队', 1)] };
    const { file, imported } = importPresets(base, [
      { name: '好友队', side: 'blue', slots: [slot('h9'), slot(null), slot(null)] },
    ]);
    expect(file.list).toHaveLength(2);
    expect(imported).toHaveLength(1);
    expect(imported[0].id).not.toBe('p_1');
    expect(imported[0].no).toBe(2);
    expect(file.list.some((p) => p.name === '我的队')).toBe(true);
  });

  it('同边同名自动加序号避让', () => {
    const base = { maxNo: 1, list: [preset('p_1', '双减魏智', 1)] };
    const { imported } = importPresets(base, [
      { name: '双减魏智', side: 'red', slots: [slot('h1'), slot(null), slot(null)] },
    ]);
    expect(imported[0].name).toBe('双减魏智 (2)');
  });

  it('不同边同名不冲突', () => {
    const base = { maxNo: 1, list: [preset('p_1', '双减魏智', 1, 'red')] };
    const { imported } = importPresets(base, [
      { name: '双减魏智', side: 'blue', slots: [slot('h1'), slot(null), slot(null)] },
    ]);
    expect(imported[0].name).toBe('双减魏智');
  });

  it('导入脏数据不抛错，decodeShare 把数值 clamp（红度 9→5、等级 99→50、负数加点→0、战法截断到 2）', () => {
    const text = JSON.stringify({
      presets: [
        {
          name: '脏数据',
          side: 'red',
          slots: [{ heroId: 'h1', extraSkillIds: ['x', 'y', 'z'], freePoints: { attack: -5 }, redness: 9, level: 99, treasure: null }],
        },
      ],
    });
    const entries = decodeShare(text);
    expect(entries).toHaveLength(1);
    const s = entries[0].slots[0];
    expect(s.heroId).toBe('h1');
    expect(s.extraSkillIds).toEqual(['x', 'y']);
    expect(s.freePoints.attack).toBe(0);
    expect(s.redness).toBe(5);
    expect(s.level).toBe(50);
  });
});
