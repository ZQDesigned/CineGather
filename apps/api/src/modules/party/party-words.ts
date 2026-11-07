// Original, local word set. Never include this module in a renderer bundle.
export interface PartyWord {
  answer: string;
  modes?: ("draw" | "quiz")[];
  category: string;
  clues: string[];
}
export const partyWords: PartyWord[] = [
  {
    answer: "热气球",
    category: "交通",
    clues: ["它能带人离开地面", "风会影响它前进的方向", "加热空气让它上升"],
  },
  {
    answer: "帽子",
    category: "用品",
    clues: ["可以改变头部的外观，也能帮助保暖", "可以遮挡太阳", "戴在头上"],
  },
  {
    answer: "雨伞",
    category: "用品",
    clues: ["它可以收起来", "下雨时经常使用", "撑开后能遮住头顶"],
  },
  {
    answer: "向日葵",
    category: "植物",
    clues: ["长在高高的直立茎秆顶端", "果实可以当零食", "花朵像一个黄色的太阳"],
  },
  {
    answer: "冰箱",
    category: "家电",
    clues: [
      "平时需要关紧门，取东西时才打开",
      "它通常有不止一层",
      "可以让食物保持低温",
    ],
  },
  {
    answer: "自行车",
    category: "交通",
    clues: ["可以用于出行", "通常不需要燃料", "踩动踏板，两个轮子就会转动"],
  },
  {
    answer: "企鹅",
    category: "动物",
    clues: [
      "翅膀短而扁，适合在水中划动",
      "不会飞，却能在水里快速游动",
      "身上像穿着黑白色礼服",
    ],
  },
  {
    answer: "吉他",
    category: "乐器",
    clues: [
      "手指按弦的位置会改变音高",
      "演奏时通常抱在身前",
      "常见款式有六根弦",
    ],
  },
  {
    answer: "蜗牛",
    category: "动物",
    clues: ["它移动得比较慢", "雨后有时能看到它", "背上带着螺旋形的壳"],
  },
  {
    answer: "风筝",
    category: "娱乐",
    clues: ["适合在户外玩", "需要借助风的力量", "人们用一根线牵着它"],
  },
  {
    answer: "蛋糕",
    category: "食物",
    clues: [
      "常在庆祝时摆在餐桌中央",
      "常常会分成几块",
      "生日时可能在上面插蜡烛",
    ],
  },
  {
    answer: "帐篷",
    category: "用品",
    clues: [
      "搭建时通常需要支架和地钉",
      "收起时可以装进袋子",
      "展开后能在里面休息",
    ],
  },
  {
    answer: "望远镜",
    category: "用品",
    clues: [
      "使用时需要调整镜片之间的距离",
      "经常对着远处使用",
      "可以让远处的东西看起来更近",
    ],
  },
  {
    answer: "蒲公英",
    category: "植物",
    clues: [
      "花谢后会长出容易被吹散的小绒毛",
      "种子可以随风飘走",
      "成熟后像一个白色绒球",
    ],
  },
  {
    answer: "章鱼",
    category: "动物",
    clues: ["它生活在水里", "有时会喷出墨汁", "它有八条腕"],
  },
  {
    answer: "闹钟",
    category: "用品",
    clues: [
      "即使人还在睡觉，它也会按约定发出声音",
      "可以提前设定",
      "早晨可能被它叫醒",
    ],
  },
  {
    answer: "彩虹",
    category: "自然",
    clues: ["它通常出现在天空中", "有时雨后能看见", "有多种颜色，形状像弧线"],
  },
  {
    answer: "滑梯",
    category: "娱乐",
    clues: ["游乐场里经常能见到", "通常要先爬上去", "坐下后可以从高处滑到低处"],
  },
  {
    answer: "雪人",
    category: "冬天",
    clues: ["冬天更容易见到", "可以用胡萝卜作鼻子", "人们常用两个雪球堆出它"],
  },
  {
    answer: "火车",
    category: "交通",
    clues: ["可以运送很多人", "沿着固定的路线前进", "它行驶在铁轨上"],
  },
  {
    answer: "风车",
    category: "建筑",
    clues: ["常常建在开阔的地方", "风吹来时会转动", "有的可以用来发电"],
  },
  {
    answer: "书包",
    category: "用品",
    clues: ["通常有拉链和多个收纳隔层", "学生经常用到", "通常背在背上装课本"],
  },
  {
    answer: "仙人掌",
    category: "植物",
    clues: ["肥厚的茎部能够储存水分", "沙漠中可能见到", "表面常有尖刺"],
  },
  {
    answer: "摩天轮",
    category: "娱乐",
    clues: [
      "游乐场里可以体验",
      "转动速度通常很慢",
      "坐在座舱里能升到高处看风景",
    ],
  },
  {
    answer: "海豚",
    category: "动物",
    clues: ["生活在海里的哺乳动物", "有时会跃出水面", "常被认为聪明又善于游泳"],
  },
  {
    answer: "磁铁",
    category: "用品",
    clues: [
      "两块靠近时可能相吸，也可能相斥",
      "有南极和北极",
      "可以吸住某些金属",
    ],
  },
  {
    answer: "牙刷",
    category: "用品",
    clues: ["每天可能使用两次", "上面有一排细毛", "搭配牙膏清洁牙齿"],
  },
  {
    answer: "降落伞",
    category: "装备",
    clues: ["它可以折叠收起", "在空中展开使用", "可以帮助人减慢下落速度"],
  },
  {
    answer: "钢琴",
    category: "乐器",
    clues: [
      "双手可以同时演奏旋律与伴奏",
      "脚下的踏板可以改变声音的延续效果",
      "有黑色和白色琴键",
    ],
  },
  {
    answer: "西瓜",
    category: "食物",
    clues: [
      "夏天常见的水果",
      "外皮常有绿色条纹",
      "切开后常能看到红色果肉和黑色种子",
    ],
  },
];
