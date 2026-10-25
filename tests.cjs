// node tests.cjs — 測試 index.html 內 /*ENGINE-START*/…/*ENGINE-END*/ 的計算引擎
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const src = html.slice(html.indexOf('/*ENGINE-START*/'), html.indexOf('/*ENGINE-END*/'));
const ONS = new Function(src + '; return ONS;')();

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) pass++; else { fail++; console.log('FAIL', name); } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), `${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

const base = { gender: 'male', age: 65, height: 165, weight: 60, basis: 'auto', setting: 'ward', specialty: 'medical',
  ventilator: 'none', glycemic: 'normal', renal: 'normal', route: 'oral', gi: 'normal', fluid: 'none' };
const T = o => ONS.targets(Object.assign({}, base, o));
const levels = (o, pid) => { const x = Object.assign({}, base, o); return ONS.recommend(x, ONS.targets(x), pid); };
const has = (list, re, level) => list.some(r => re.test(r.html) && (!level || r.level === level));

// IBW / BMI
eq(Math.round(ONS.ibwOf('male', 165) * 10) / 10, 59.5, 'IBW male');
eq(Math.round(ONS.ibwOf('female', 160) * 10) / 10, 54, 'IBW female');
eq(T({}).bmiClass.tone, 'info', 'BMI 22 normal');
eq(T({ weight: 45 }).bmiClass.text.startsWith('體重過輕'), true, 'BMI underweight');
eq(T({ weight: 70 }).bmiClass.tone, 'primary', 'BMI 25.7 overweight');

// 驗證
ok(T({ height: 60 }).errors.length === 1, 'height too low rejected (negative IBW)');
ok(T({ weight: NaN }).errors.length === 1, 'blank weight rejected');
ok(T({ age: 10 }).errors.length === 1, 'child rejected');

// 計算體重
eq(T({}).basis, 'ibw', 'weight 60 vs IBW 59.5 → IBW');
eq(T({ weight: 50 }).basis, 'actual', 'weight < IBW → actual');
eq(T({ weight: 50 }).kcal.lo, 1250, 'actual 50 × 25');
eq(T({ weight: 90 }).basis, 'adjusted', '>120% IBW → adjusted');
eq(Math.round(T({ weight: 90 }).doseW * 10) / 10, 67.1, 'adjusted = 59.5 + 0.25 × 30.5');
eq(T({ weight: 50, basis: 'ibw' }).kcal.lo, Math.round(ONS.ibwOf('male', 165) * 25), 'manual IBW basis');

// 熱量
eq([T({}).kcal.perLo, T({}).kcal.perHi], [25, 30], 'general 25–30');
eq([T({ setting: 'icu' }).kcal.perLo, T({ setting: 'icu' }).kcal.perHi], [25, 30], 'ICU 25–30 (ASPEN 2016)');
eq(T({ specialty: 'burn' }).kcal.perLo, 35, 'burn 35–40');
const ob = T({ setting: 'icu', weight: 90 });   // BMI 33
eq([ob.obeseIcu, ob.kcal.perLo, ob.kcal.w], [true, 11, 90], 'ICU obese 11–14 actual');
eq([ob.pro.perLo, ob.pro.perHi, Math.round(ob.pro.w * 10) / 10], [2, 2, 59.5], 'ICU obese BMI 30–40 protein 2.0 g/kg IBW');
const ob2 = T({ setting: 'icu', weight: 115 }); // BMI 42
eq([ob2.pro.perLo, ob2.pro.perHi], [2, 2.5], 'ICU BMI ≥40 protein 2.0–2.5');
const ob3 = T({ setting: 'icu', weight: 140 }); // BMI 51
eq([ob3.kcal.perLo, ob3.kcal.perHi, ob3.kcal.wLabel], [22, 25, 'IBW'], 'ICU BMI >50 22–25 kcal/kg IBW');
eq(T({ weight: 90 }).obeseIcu, false, 'obese on ward is not ICU formula');

// 蛋白質
eq([T({}).pro.perLo, T({}).pro.perHi], [1, 1.2], 'general protein');
eq([T({ setting: 'icu', specialty: 'sepsis' }).pro.perLo, T({ setting: 'icu', specialty: 'sepsis' }).pro.perHi], [1.2, 2], 'ICU sepsis 1.2–2.0 (old code gave 1.2–1.5)');
eq(T({ specialty: 'surgical' }).pro.perHi, 1.5, 'ward surgical 1.2–1.5');
eq([T({ specialty: 'burn' }).pro.perLo, T({ specialty: 'burn' }).pro.perHi], [1.5, 2], 'burn 1.5–2.0');
eq(T({ specialty: 'oncology' }).pro.perHi, 1.5, 'oncology up to 1.5');
eq([T({ renal: 'ckd35' }).pro.perLo, T({ renal: 'ckd35' }).pro.perHi], [0.6, 0.8], 'CKD 3–5 stable 0.6–0.8');
eq(T({ renal: 'ckd35', setting: 'icu' }).pro.perHi, 2, 'CKD 3–5 in ICU not restricted');
eq(T({ renal: 'ckd12' }).pro.perHi, 1.2, 'CKD 1–2 not restricted');
eq([T({ renal: 'hd' }).pro.perLo, T({ renal: 'hd' }).pro.perHi], [1, 1.2], 'HD 1.0–1.2 (KDOQI 2020)');
eq(T({ renal: 'hd', setting: 'icu' }).pro.perHi, 2, 'HD in ICU uses ICU range');
eq([T({ renal: 'crrt' }).pro.perLo, T({ renal: 'crrt' }).pro.perHi], [1.5, 2.5], 'CRRT 1.5–2.5');
eq(T({ renal: 'crrt', setting: 'icu', weight: 90 }).pro.perHi, 2.5, 'obese ICU on CRRT up to 2.5');

// 水分
eq(T({}).fluid.ml, Math.round(59.5 * 30), 'fluid 30 mL/kg');
eq(T({ fluid: 'restricted' }).fluid.ml, T({}).kcal.lo, 'restricted = 1 mL/kcal of min');
eq(T({ renal: 'hd' }).fluid.ml, null, 'HD fluid individualised');

// 供應量：模組熱量與蛋白質都要算
const s = ONS.supply({ productId: '2814162', canCal: 251, canPro: 8.8, canCount: 6, proMod: 'yuanqi', proCount: 2, calMod: 'yinengchong', calCount: 1 });
eq(s.kcal, 251 * 6 + 104 * 2 + 200, 'kcal includes both modules');
eq(s.pro, Math.round((8.8 * 6 + 8.4 * 2 + 0.8) * 10) / 10, 'protein includes both modules');
eq(ONS.supply({ productId: '2814162', canCal: 251, canPro: 8.8, canCount: 4, proMod: '', proCount: 5 }).kcal, 1004, 'count ignored when module not selected');
eq(ONS.supply({ productId: '2814039', canCal: 478, canPro: 19.9, canCount: 2 }).water, Math.round(474 * 0.7), '2 kcal/mL water 70%');

// judge：以目標範圍中位數計算達成率（舊版因 parseInt(array) 只用下限）
eq(ONS.judge(1650, 1500, 1800), { pct: 100, status: 'ok', text: '達目標範圍' }, 'judge mid');
eq(ONS.judge(1400, 1500, 1800).status, 'low', 'judge low');
eq(ONS.judge(2000, 1500, 1800).status, 'high', 'judge high');

// 品項資料（對照 ons-choice-for-all 已查證資料）
const P = c => ONS.PRODUCTS.find(p => p.code === c || p.name === c);
eq([P('1828191').kcal, P('1828191').pro], [330, 20], '安素Ex 220 mL');
eq(P('2814012').kcal, 425, '腎補納 425 kcal');
eq([P('三多 補体康LPF腎臟病配方').kcal, P('三多 補体康LPF腎臟病配方').pro], [425, 8.5], 'LPF');
eq([P('桂格 完膳洗腎').kcal, P('桂格 完膳洗腎').pro], [475, 21.4], '完膳洗腎');
eq(P('2814227').kcal, 375, '速益復');
ok(new Set(ONS.PRODUCTS.map(ONS.productId)).size === ONS.PRODUCTS.length, 'product ids unique');

// 推薦
ok(has(levels({}), /一般均衡/), 'default general rec');
ok(has(levels({ setting: 'icu', specialty: 'sepsis' }), /高蛋白標準配方/, 'rec'), 'ICU sepsis → high-protein rec');
ok(has(levels({ renal: 'ckd35' }), /腎補納/), 'CKD rec');
ok(!has(levels({ renal: 'ckd35', setting: 'icu' }), /未洗腎腎臟病/), 'no low-protein rec in ICU');
ok(has(levels({ renal: 'ckd35' }, '2814013'), /高蛋白配方/, 'warn'), 'CKD + 普寧勝 mismatch warn');
ok(has(levels({ renal: 'hd' }, '2814012'), /低蛋白配方/, 'warn'), 'HD + 腎補納 mismatch warn');
ok(has(levels({}, '1828113'), /非完整營養/, 'warn'), '基速得 as main warn');
ok(has(levels({ specialty: 'sepsis', setting: 'icu' }), /精胺酸/, 'warn'), 'sepsis arginine warn');
ok(!has(levels({ route: 'peg' }), /胜肽/), 'PEG no longer forces peptide');
ok(has(levels({ route: 'jtube' }), /連續滴注/), 'J-tube pump');
ok(has(levels({ gi: 'malabsorption' }), /胜肽/), 'malabsorption → peptide');
ok(has(levels({ gi: 'diarrhea' }), /不應自動停止/), 'diarrhea advice');
ok(has(levels({ ventilator: 'hypercapnia' }), /過度餵食/), 'hypercapnia advice');
ok(has(levels({ specialty: 'burn' }), /0\.3–0\.5 g\/kg/), 'burn glutamine dose');
ok(has(levels({ route: 'ng' }, '2814163'), /未標示可管灌/), 'tube-unlabelled info');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
