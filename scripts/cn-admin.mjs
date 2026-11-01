/*
 * 中国省级行政区的基础表。
 *
 * 这张表是所有归属判断的唯一真相来源，被两个地方共用：
 *   - build-cn-places.mjs：按 GeoNames 的 admin1 编码给每个城市写上所属省
 *   - cn-geo.mjs：从台名 / state 字段里认省、认省会坐标
 *
 * 为什么要有它：以前 cn-geo.mjs 里有一张只够「认省 + 拿省会坐标」的表，
 * 缺两样东西——行政区划代码，以及「城市属于哪个省」的映射。
 * 结果是能算出坐标，却产不出「这个台属于湖南」这一条事实。
 *
 * 三个编码体系混在一起，注意别用错：
 *   gn   GeoNames 的 admin1 编码（FIPS 式：11=湖南、22=北京、33=重庆），
 *        只用来读 CN.txt，和国标编号完全不是一回事。
 *   code 国标行政区划代码（430000=湖南），对外展示、排序、筛选都用它。
 *   abbr 中文简称 / 车牌字母（湘、粤），只用于 state 字段的**整值**匹配，
 *        绝不参与台名子串匹配——「京」会命中「北京」，「陕」会命中「陕西」。
 */

export const PROVINCES = [
  /* ── 直辖市 ── */
  {
    name: "北京", code: "110000", gn: "22", lat: 39.9042, lon: 116.4074,
    alias: ["beijing", "peking", "peiping", "北京", "京城", "首都"],
    abbr: ["bj", "bej", "京"],
  },
  {
    name: "上海", code: "310000", gn: "23", lat: 31.2304, lon: 121.4737,
    alias: ["shanghai", "上海", "沪上", "申城", "魔都"],
    abbr: ["sh", "sha", "沪", "申"],
  },
  {
    name: "天津", code: "120000", gn: "28", lat: 39.1256, lon: 117.1902,
    alias: ["tianjin", "tientsin", "天津", "津门"],
    abbr: ["tj", "tin", "津"],
  },
  {
    name: "重庆", code: "500000", gn: "33", lat: 29.563, lon: 106.5516,
    alias: ["chongqing", "chungking", "重庆", "山城", "渝州"],
    abbr: ["cq", "chq", "渝"],
  },

  /* ── 省 ── */
  {
    name: "河北", code: "130000", gn: "10", lat: 38.0428, lon: 114.5149,
    alias: ["hebei", "hopeh", "hopei", "河北", "燕赵"],
    abbr: ["he", "heb", "冀"],
  },
  {
    name: "山西", code: "140000", gn: "24", lat: 37.857, lon: 112.5492,
    alias: ["shanxi", "shansi", "山西", "三晋"],
    // shx 是 ISO 的山西；sx 在陕西那边也用，属歧义缩写，两边都不收
    abbr: ["shx", "sxi", "晋"],
  },
  {
    name: "辽宁", code: "210000", gn: "19", lat: 41.8057, lon: 123.4315,
    alias: ["liaoning", "fengtien", "fengtian", "辽宁", "辽沈"],
    abbr: ["ln", "lia", "辽"],
  },
  {
    name: "吉林", code: "220000", gn: "05", lat: 43.8171, lon: 125.3235,
    alias: ["jilin", "kirin", "吉林"],
    abbr: ["jl", "jil", "吉"],
  },
  {
    name: "黑龙江", code: "230000", gn: "08", lat: 45.8038, lon: 126.535,
    alias: ["heilongjiang", "heilungkiang", "amur river", "黑龙江", "龙江", "黑土"],
    abbr: ["hl", "hlj", "黑"],
  },
  {
    name: "江苏", code: "320000", gn: "04", lat: 32.0603, lon: 118.7969,
    alias: ["jiangsu", "kiangsu", "chiangsu", "江苏", "苏南", "苏北"],
    abbr: ["js", "jis", "苏"],
  },
  {
    name: "浙江", code: "330000", gn: "02", lat: 30.2741, lon: 120.1551,
    alias: ["zhejiang", "chekiang", "chehkiang", "浙江", "之江", "两浙"],
    abbr: ["zj", "zhe", "浙"],
  },
  {
    name: "安徽", code: "340000", gn: "01", lat: 31.8206, lon: 117.2272,
    alias: ["anhui", "anhwei", "安徽", "江淮"],
    abbr: ["ah", "anm", "皖"],
  },
  {
    name: "福建", code: "350000", gn: "07", lat: 26.0745, lon: 119.2965,
    alias: ["fujian", "fukien", "福建", "八闽", "闽南"],
    abbr: ["fj", "fuj", "闽"],
  },
  {
    name: "江西", code: "360000", gn: "03", lat: 28.682, lon: 115.8579,
    alias: ["jiangxi", "kiangsi", "江西", "赣鄱"],
    abbr: ["jx", "jxi", "赣"],
  },
  {
    name: "山东", code: "370000", gn: "25", lat: 36.6512, lon: 117.1201,
    // 不收 "sha"：上海的三字母缩写也是它，只能有一个省拿到
    alias: ["shandong", "shantung", "山东", "齐鲁"],
    abbr: ["sd", "鲁"],
  },
  {
    name: "河南", code: "410000", gn: "09", lat: 34.7466, lon: 113.6254,
    alias: ["henan", "honan", "河南", "中原", "豫州"],
    abbr: ["hn", "hen", "豫"],
  },
  {
    name: "湖北", code: "420000", gn: "12", lat: 30.5928, lon: 114.3055,
    alias: ["hubei", "hupeh", "hupei", "湖北", "荆楚"],
    abbr: ["hb", "hub", "鄂"],
  },
  {
    name: "湖南", code: "430000", gn: "11", lat: 28.2282, lon: 112.9388,
    alias: ["hunan", "湖南", "潇湘", "三湘"],
    abbr: ["hun", "湘"],
  },
  {
    name: "广东", code: "440000", gn: "30", lat: 23.1291, lon: 113.2644,
    alias: ["guangdong", "kwangtung", "kuangtung", "canton", "广东", "南粤", "岭南"],
    abbr: ["gd", "gud", "粤"],
  },
  {
    name: "海南", code: "460000", gn: "31", lat: 20.0442, lon: 110.1999,
    alias: ["hainan", "海南", "琼州", "椰城"],
    abbr: ["hi", "hai", "琼"],
  },
  {
    name: "四川", code: "510000", gn: "32", lat: 30.5728, lon: 104.0668,
    alias: ["sichuan", "szechwan", "szechuan", "四川", "巴蜀", "天府", "川渝"],
    abbr: ["sc", "sic", "川", "蜀"],
  },
  {
    name: "贵州", code: "520000", gn: "18", lat: 26.647, lon: 106.6302,
    alias: ["guizhou", "kweichow", "kweichou", "贵州", "黔中"],
    abbr: ["gz", "gui", "黔", "贵"],
  },
  {
    name: "云南", code: "530000", gn: "29", lat: 25.0389, lon: 102.7183,
    alias: ["yunnan", "云南", "彩云", "滇池"],
    abbr: ["yn", "yun", "滇", "云"],
  },
  {
    name: "陕西", code: "610000", gn: "26", lat: 34.3416, lon: 108.9398,
    alias: ["shaanxi", "shensi", "陕西", "三秦", "关中"],
    abbr: ["sn", "陕", "秦"],
  },
  {
    name: "甘肃", code: "620000", gn: "15", lat: 36.0611, lon: 103.8343,
    alias: ["gansu", "kansu", "甘肃", "陇原"],
    abbr: ["gs", "gan", "甘", "陇"],
  },
  {
    name: "青海", code: "630000", gn: "06", lat: 36.6171, lon: 101.7782,
    alias: ["qinghai", "tsinghai", "青海"],
    abbr: ["qh", "qin", "青"],
  },

  /* ── 自治区 ── */
  {
    name: "内蒙古", code: "150000", gn: "20", lat: 40.8424, lon: 111.749,
    alias: ["inner mongolia", "neimenggu", "nei mongol", "内蒙古", "内蒙"],
    abbr: ["nm", "nmg", "蒙"],
  },
  {
    name: "广西", code: "450000", gn: "16", lat: 22.817, lon: 108.3665,
    alias: ["guangxi", "kwangsi", "广西", "八桂"],
    abbr: ["gx", "gux", "桂"],
  },
  {
    name: "西藏", code: "540000", gn: "14", lat: 29.652, lon: 91.1721,
    alias: ["tibet", "xizang", "西藏", "雪域"],
    abbr: ["xz", "xiz", "藏"],
  },
  {
    name: "宁夏", code: "640000", gn: "21", lat: 38.4872, lon: 106.2309,
    alias: ["ningxia", "ningsia", "宁夏", "塞上"],
    abbr: ["nx", "nin", "宁"],
  },
  {
    name: "新疆", code: "650000", gn: "13", lat: 43.8256, lon: 87.6168,
    alias: ["xinjiang", "sinkiang", "新疆", "天山", "西域"],
    abbr: ["xj", "xin", "新"],
  },

  /*
   * ── 特别行政区与台湾 ──
   *
   * 港澳台在 radio-browser 里各有自己的 countrycode（HK / MO / TW），
   * 不在 GeoNames 的 CN 数据集里，所以既要单独给省表补三条，也要给城市表补点。
   * 归属上它们是中国的省级行政区，展示时写「中国香港」这类全称。
   */
  {
    name: "香港", code: "810000", gn: "", lat: 22.3193, lon: 114.1694,
    alias: ["hong kong", "hongkong", "香港", "港九"],
    abbr: ["hk", "hkg", "港"],
    country: "HK",
    display: "中国香港",
  },
  {
    name: "澳门", code: "820000", gn: "", lat: 22.1987, lon: 113.5439,
    alias: ["macau", "macao", "澳门", "澳門"],
    abbr: ["mo", "mac", "澳"],
    country: "MO",
    display: "中国澳门",
  },
  {
    name: "台湾", code: "710000", gn: "", lat: 25.033, lon: 121.5654,
    alias: ["taiwan", "formosa", "台湾", "臺灣", "寶島", "宝岛"],
    abbr: ["tw", "twn", "台", "臺"],
    country: "TW",
    display: "中国台湾",
  },
];

/** 国标代码 → 省 */
export const PROVINCE_BY_CODE = new Map(PROVINCES.map((p) => [p.code, p]));

/** GeoNames admin1 编码 → 省。读 CN.txt 时用，别和国标代码混了。 */
export const PROVINCE_BY_GN = new Map(
  PROVINCES.filter((p) => p.gn).map((p) => [p.gn, p]),
);

/** countrycode → 省。CN 有三十多个省，不在这里；只登记「一国即一省」的三个。 */
export const PROVINCE_BY_COUNTRY = new Map(
  PROVINCES.filter((p) => p.country).map((p) => [p.country, p]),
);

/**
 * 省会。
 *
 * 不能只靠「离省中心最近、人口最多的那个点」去猜：台湾的中心点附近，
 * 新北（400 万）比台北（265 万）人口多且几乎同一个位置，猜出来会把
 * 一百多个台湾台全标成「新北」。省会是行政事实，不是人口排序的结果，
 * 所以写死。
 *
 * 只用于「知道是哪个省、但不知道是哪座城」时给落点，不会覆盖台名里的城市。
 */
export const CAPITALS = {
  北京: "北京", 天津: "天津", 河北: "石家庄", 山西: "太原", 内蒙古: "呼和浩特",
  辽宁: "沈阳", 吉林: "长春", 黑龙江: "哈尔滨", 上海: "上海", 江苏: "南京",
  浙江: "杭州", 安徽: "合肥", 福建: "福州", 江西: "南昌", 山东: "济南",
  河南: "郑州", 湖北: "武汉", 湖南: "长沙", 广东: "广州", 广西: "南宁",
  海南: "海口", 重庆: "重庆", 四川: "成都", 贵州: "贵阳", 云南: "昆明",
  西藏: "拉萨", 陕西: "西安", 甘肃: "兰州", 青海: "西宁", 宁夏: "银川",
  新疆: "乌鲁木齐", 香港: "香港", 澳门: "澳门", 台湾: "台北",
};

/**
 * 港澳台的城市点。
 *
 * 大陆那 3528 个点来自 GeoNames，港澳台不在那份文件里，只能手工补。
 * 只收台呼里真的会出现的城市，不求全：香港、九龙、澳门，以及台湾本岛
 * 从北到南的几个市。坐标取市中心，够用——反正落点本来就带抖动。
 */
export const HKMO_TW_PLACES = [
  { n: "Hong Kong", z: "香港", pv: "香港", lat: 22.3193, lon: 114.1694, p: 7500000, a: ["hongkong", "hong kong", "xianggang"], za: ["香港", "港岛"] },
  { n: "Kowloon", z: "九龙", pv: "香港", lat: 22.3167, lon: 114.1833, p: 2100000, a: ["kowloon", "jiulong"], za: ["九龙", "九龍"] },
  { n: "Macau", z: "澳门", pv: "澳门", lat: 22.1987, lon: 113.5439, p: 650000, a: ["macau", "macao", "aomen"], za: ["澳门", "澳門"] },
  { n: "Taipei", z: "台北", pv: "台湾", lat: 25.033, lon: 121.5654, p: 2650000, a: ["taipei", "taibei"], za: ["台北", "臺北"] },
  { n: "New Taipei", z: "新北", pv: "台湾", lat: 25.0128, lon: 121.4653, p: 4000000, a: ["newtaipei", "xinbei", "banqiao"], za: ["新北", "板桥"] },
  { n: "Taoyuan", z: "桃园", pv: "台湾", lat: 24.9936, lon: 121.301, p: 2270000, a: ["taoyuan"], za: ["桃园", "桃園"] },
  { n: "Hsinchu", z: "新竹", pv: "台湾", lat: 24.8138, lon: 120.9675, p: 450000, a: ["hsinchu", "xinzhu"], za: ["新竹"] },
  { n: "Taichung", z: "台中", pv: "台湾", lat: 24.1477, lon: 120.6736, p: 2800000, a: ["taichung", "taizhong"], za: ["台中", "臺中"] },
  { n: "Changhua", z: "彰化", pv: "台湾", lat: 24.0756, lon: 120.5442, p: 230000, a: ["changhua", "zhanghua"], za: ["彰化"] },
  { n: "Chiayi", z: "嘉义", pv: "台湾", lat: 23.4801, lon: 120.4491, p: 270000, a: ["chiayi", "jiayi"], za: ["嘉义", "嘉義"] },
  { n: "Tainan", z: "台南", pv: "台湾", lat: 22.9999, lon: 120.2269, p: 1880000, a: ["tainan", "tainan city"], za: ["台南", "臺南"] },
  { n: "Kaohsiung", z: "高雄", pv: "台湾", lat: 22.6273, lon: 120.3014, p: 2770000, a: ["kaohsiung", "gaoxiong"], za: ["高雄"] },
  { n: "Pingtung", z: "屏东", pv: "台湾", lat: 22.6761, lon: 120.4942, p: 200000, a: ["pingtung", "pingdong"], za: ["屏东", "屏東"] },
  { n: "Yilan", z: "宜兰", pv: "台湾", lat: 24.757, lon: 121.753, p: 450000, a: ["yilan", "ilan"], za: ["宜兰", "宜蘭"] },
  { n: "Hualien", z: "花莲", pv: "台湾", lat: 23.9911, lon: 121.6112, p: 100000, a: ["hualien", "hualian"], za: ["花莲", "花蓮"] },
  { n: "Taitung", z: "台东", pv: "台湾", lat: 22.7583, lon: 121.1444, p: 106000, a: ["taitung", "taidong"], za: ["台东", "臺東"] },
  { n: "Keelung", z: "基隆", pv: "台湾", lat: 25.1276, lon: 121.7392, p: 370000, a: ["keelung", "jilong"], za: ["基隆"] },
  { n: "Penghu", z: "澎湖", pv: "台湾", lat: 23.5711, lon: 119.5793, p: 100000, a: ["penghu", "magong"], za: ["澎湖", "马公"] },
];

/**
 * 域名线索：台站主页 / 流地址里的域名后缀 → 省。
 *
 * 只在四级线索（品牌词典、台名城市、台名省份、state）全部认不出时才用，
 * 而且最高只给 medium——「省级广电的域名下挂着一档全国联播」这种情况是有的。
 *
 * 刻意收得很窄：只放那些一眼能确认归属的省级广电域名，
 * 聚合平台（ajmide / qingting / 各类 CDN）一律不收，它们的路径编号
 * 和台的关系没有任何可读的规律，收了只会制造假阳性。
 */
export const DOMAIN_HINTS = [
  ["hnradio.com", "湖南"],
  ["gdtv.cn", "广东"],
  ["gdradio.cn", "广东"],
  ["jsbc.com", "江苏"],
  ["zjstv.com", "浙江"],
  ["smg.cn", "上海"],
  ["ahtv.cn", "安徽"],
  ["fjtv.net", "福建"],
  ["jxntv.cn", "江西"],
  ["sdtv.cn", "山东"],
  ["hntv.tv", "河南"],
  ["hbtv.com.cn", "湖北"],
  ["lntv.com.cn", "辽宁"],
  ["hljtv.com", "黑龙江"],
  ["sxrtv.com", "山西"],
  ["sctv.com", "四川"],
  ["cqtv.com.cn", "重庆"],
  ["yntv.cn", "云南"],
  ["gstv.com.cn", "甘肃"],
  ["nxtv.cn", "宁夏"],
  ["xjtv.com", "新疆"],
  ["xztv.cn", "西藏"],
  ["gxtv.cn", "广西"],
  ["rthk.hk", "香港"],
  ["rthk.org.hk", "香港"],
  ["tdm.com.mo", "澳门"],
];
