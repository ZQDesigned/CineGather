import { expect, test } from "bun:test";
import { partyWordSeed } from "../src/modules/party/party-word-seed";

const category = (answer: string) => {
  const word = partyWordSeed.find((w) => w.answer === answer);
  expect(word, answer).toBeDefined();
  return word!.category;
};
test("game-specific characters and items are filed under their own games", () => {
  for (const [answer, expected] of [
    ["丘丘人", "原神"],
    ["派蒙", "原神"],
    ["史蒂夫", "我的世界"],
    ["红石中继器", "我的世界"],
    ["皮卡丘", "宝可梦"],
    ["精灵球", "宝可梦"],
    ["马里奥", "超级马力欧"],
    ["问号方块", "超级马力欧"],
    ["林克", "塞尔达传说"],
    ["海利亚盾", "塞尔达传说"],
    ["豌豆射手", "植物大战僵尸"],
    ["亚索", "英雄联盟"],
    ["猎空", "守望先锋"],
    ["克劳德", "最终幻想"],
    ["奎托斯", "战神"],
    ["劳拉", "古墓丽影"],
    ["杰洛特", "巫师"],
    ["士官长", "光环"],
    ["卡比", "星之卡比"],
    ["索尼克", "索尼克"],
    ["吃豆人", "吃豆人"],
    ["春丽", "街头霸王"],
  ])
    expect(category(answer!)).toBe(expected!);
});
test("shared game concepts remain shared and hardware is not an in-game item", () => {
  expect(category("史莱姆")).toBe("游戏角色");
  expect(category("烟雾弹")).toBe("游戏道具");
  expect(category("生命药水")).toBe("游戏道具");
  expect(category("创造模式")).toBe("游戏玩法");
  expect(category("游戏手柄")).toBe("数码设备");
  expect(category("记忆卡")).toBe("数码设备");
  expect(category("属性面板")).toBe("游戏玩法");
  expect(category("宝箱怪")).toBe("游戏角色");
  expect(partyWordSeed).toHaveLength(1650);
});
