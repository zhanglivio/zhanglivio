/* =====================================================================
 *  客户数据 —— 你只需要维护这个文件
 * =====================================================================
 *
 *  每个客户一条记录，字段说明：
 *    company            客户抬头（公司名）
 *    country            国家 ISO2 代码（大写）：IT=意大利, FR=法国, DE=德国, ES=西班牙...
 *    region             大区名称（要和地图大区名一致，意大利见下方说明）
 *    city               城市名
 *    lat, lng           城市经纬度（用于在地图上打点；同城客户可填同一坐标）
 *    daysSinceContact   距上次“联系”的天数  ← “久未联系”视角看这个
 *    daysSinceRepurchase 距上次回购的天数
 *    debt               当前欠款金额
 *    currency           货币符号，默认 "€"
 *    note               备注（可选）
 *
 *  ★ 这个看板的用途：看“哪里空白（没客户=待开发）”和“哪里客户变冷（久未联系=要维护）”。
 *    所以 daysSinceContact 很重要；没有这个数据就先填 daysSinceRepurchase 也行。
 *
 *  意大利大区名（region 字段请用这些之一）：
 *    Lombardia, Lazio, Campania, Sicilia, Veneto, Piemonte, Emilia-Romagna,
 *    Toscana, Puglia, Calabria, Sardegna, Liguria, Marche, Abruzzo, Friuli
 *    Venezia Giulia, Trentino-Alto Adige, Umbria, Basilicata, Molise,
 *    "Valle d'Aosta"
 *
 *  城市坐标懒得查也没关系：先把 company / region / city / 天数 / 欠款 填上，
 *  没有 lat/lng 的城市我会自动归到大区中心。
 * ===================================================================== */

const CUSTOMERS = [
  // ——— 米兰示例（你说有 3 个客人，先放占位，等你给真实资料）———
  { company: "示例客户 A srl", country: "IT", region: "Lombardia", city: "Milano",
    lat: 45.4642, lng: 9.1900, daysSinceContact: 8,   daysSinceRepurchase: 12,  debt: 0,     currency: "€", note: "" },
  { company: "示例客户 B spa", country: "IT", region: "Lombardia", city: "Milano",
    lat: 45.4642, lng: 9.1900, daysSinceContact: 40,  daysSinceRepurchase: 47,  debt: 8600,  currency: "€", note: "" },
  { company: "示例客户 C srl", country: "IT", region: "Lombardia", city: "Milano",
    lat: 45.4642, lng: 9.1900, daysSinceContact: 210, daysSinceRepurchase: 156, debt: 23400, currency: "€", note: "重点跟进" },

  // ——— 其它示例，演示多城市 / 多国家 / 不同冷热 ———
  { company: "Roma 客户示例", country: "IT", region: "Lazio", city: "Roma",
    lat: 41.9028, lng: 12.4964, daysSinceContact: 25,  daysSinceRepurchase: 33, debt: 1500, currency: "€" },
  { company: "Napoli 客户示例", country: "IT", region: "Campania", city: "Napoli",
    lat: 40.8518, lng: 14.2681, daysSinceContact: 120, daysSinceRepurchase: 90, debt: 5000, currency: "€" },
  { company: "Paris 客户示例", country: "FR", region: "Île-de-France", city: "Paris",
    lat: 48.8566, lng: 2.3522,  daysSinceContact: 15,  daysSinceRepurchase: 20, debt: 0,    currency: "€" },
  { company: "Berlin 客户示例", country: "DE", region: "Berlin", city: "Berlin",
    lat: 52.5200, lng: 13.4050, daysSinceContact: 180, daysSinceRepurchase: 200, debt: 3200, currency: "€", note: "快流失，去维护" },
  { company: "Madrid 客户示例", country: "ES", region: "Madrid", city: "Madrid",
    lat: 40.4168, lng: -3.7038, daysSinceContact: 60,  daysSinceRepurchase: 70, debt: 900,  currency: "€" },
];

/* ---------------------------------------------------------------------
 *  阈值：用来给“天数 / 欠款”上色（绿/黄/红）。可按业务调整。
 * ------------------------------------------------------------------- */
const THRESHOLDS = {
  contact:    { ok: 30, warn: 90 },   // 久未联系：<=30天绿；<=90天黄；>90天红
  repurchase: { ok: 30, warn: 90 },   // <=30天绿；<=90天黄；>90天红
  debt:       { ok: 0,  warn: 5000 }, // =0灰；<=5000黄；>5000红
};

/* =====================================================================
 *  地图配置（一般不用改）
 * =====================================================================
 *  regionSources：每个国家“大区”GeoJSON 的地址 + 取名字用的字段。
 *  目前内置意大利。需要别的国家时按同样格式加一行即可。
 * ===================================================================== */
const MAP_CONFIG = {
  europeGeoJSON:
    "https://cdn.jsdelivr.net/gh/leakyMirror/map-of-europe@master/GeoJSON/europe.geojson",
  regionSources: {
    IT: {
      url: "https://cdn.jsdelivr.net/gh/openpolis/geojson-italy@master/geojson/limits_IT_regions.geojson",
      nameProp: "reg_name",
    },
    // 示例：以后要加法国大区，取消注释并补一个可用的 GeoJSON 源即可
    // FR: { url: "...", nameProp: "nom" },
  },
};
