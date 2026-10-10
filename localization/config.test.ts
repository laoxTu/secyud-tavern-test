import { describe, expect, it } from 'vitest';

import {
  defaultLocale,
  locales,
  timeZones,
} from '@/localization/config';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('../generated/generated.cases.json')).default);
}

describe('localization config / locales', () => {
  it('语言列表应当与用例数据一致', async () => {
    const data = await loadCases();

    expect(locales).toEqual(data.locales);
  });

  it('默认语言必须在支持列表里', () => {
    expect(locales).toContain(defaultLocale);
  });

  it('语言码应当是小写的短码', () => {
    for (const locale of locales) {
      expect(locale).toMatch(/^[a-z]{2}(-[A-Z]{2})?$/);
    }
  });
});

describe('localization config / timeZones', () => {
  it('地区码到时区的映射应当都形如 区域/城市', () => {
    for (const [region, zone] of Object.entries(timeZones)) {
      expect(region, region).toMatch(/^[A-Z]{2}$/);
      expect(zone, region).toMatch(/^[A-Za-z]+\/[A-Za-z_]+$/);
    }
  });

  it('应当包含默认地区 CN', () => {
    // request.ts 在没有 region 时回落到 'CN'
    expect(timeZones).toHaveProperty('CN');
  });

  it('时区值应当能被 Intl 接受（别名也算）', () => {
    for (const [region, zone] of Object.entries(timeZones)) {
      expect(
        () => new Intl.DateTimeFormat('en', { timeZone: zone }),
        region,
      ).not.toThrow();
    }
  });
});
