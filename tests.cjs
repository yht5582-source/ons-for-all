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

// 腫瘤魚油：不列 ESPEN 2021 實務指引未載明的 EPA 劑量
ok(!levels({ specialty: 'oncology' }).some(r => /2 g\/day/.test(r.html)), 'no EPA dose');
ok(has(levels({ specialty: 'oncology' }), /弱建議/, 'rec'), 'fish oil weak recommendation');
// 呼吸器＋CKD 3–5：不限制蛋白質
{ const v = T({ renal: 'ckd35', ventilator: 'normal' }); eq([v.acute, v.pro.perLo, v.pro.perHi], [true, 1.2, 2], 'ward ventilator CKD not restricted'); ok(v.notes.some(n => /長期呼吸器/.test(n)), 'chronic ventilator note'); }
ok(!T({ renal: 'ckd35', setting: 'icu', ventilator: 'normal' }).notes.some(n => /長期呼吸器/.test(n)), 'no chronic note in ICU');
ok(!has(levels({ renal: 'ckd35', ventilator: 'normal' }), /未洗腎腎臟病/), 'ventilator CKD no low-protein rec');
ok(!has(levels({ renal: 'ckd35', ventilator: 'normal' }, '2814013'), /高蛋白配方/, 'warn'), 'ventilator CKD no high-protein warn');
// 糖尿病＋CKD：穩定期腎臟配方優先，急性期不優先
ok(has(levels({ renal: 'ckd35', glycemic: 'diabetes' }), /腎臟\/透析配方為優先/, 'rec'), 'DM stable CKD renal first');
ok(!has(levels({ renal: 'ckd35', glycemic: 'diabetes', specialty: 'sepsis' }), /腎臟\/透析配方為優先/), 'DM acute CKD not renal first');
ok(has(levels({ renal: 'ckd35', glycemic: 'diabetes', specialty: 'sepsis' }), /不以低蛋白腎臟配方為優先/, 'rec'), 'DM acute CKD wording');
ok(has(levels({ renal: 'hd', glycemic: 'diabetes', setting: 'icu' }), /腎臟\/透析配方為優先/, 'rec'), 'DM HD still renal first');

// ── 教學內容 ──
const block = (a, b) => html.slice(html.indexOf(a), html.indexOf(b));
const { CASES, caseCalc, QUIZ, MAP, MAP_ROOT } = new Function('ONS', block('/*CASES-START*/', '/*CASES-END*/') + block('/*QUIZ-START*/', '/*QUIZ-END*/') + block('/*MAP-START*/', '/*MAP-END*/') + '; return { CASES, caseCalc, QUIZ, MAP, MAP_ROOT };')(ONS);
eq(CASES.length, 6, '6 cases');
CASES.forEach(c => {
  const k = caseCalc(c.x, c.rx, ONS), e = c.expect;
  eq([k.t.kcal.lo, k.t.kcal.hi], e.kcal, c.id + ' kcal target');
  eq([k.t.pro.lo, k.t.pro.hi], e.pro, c.id + ' protein target');
  eq(k.t.fluid.ml, e.fluid, c.id + ' fluid');
  eq([k.s.kcal, k.s.pro], e.supply, c.id + ' supply');
  eq(k.s.water, e.water, c.id + ' water');
  [c.rx].concat(c.alts).forEach(rx => ok(ONS.findProduct(rx.pid), c.id + ' product exists ' + rx.pid));
});
const CC = id => CASES.find(c => c.id === id);
const alt = (id, i) => caseCalc(CC(id).x, CC(id).alts[i], ONS);
// c1：起始低於目標但在 10–20 kcal/kg 內；3 罐落在目標內
{ const k = caseCalc(CC('c1').x, CC('c1').rx, ONS); eq(k.jc.status, 'low', 'c1 start below goal'); ok(k.s.kcal >= 420 && k.s.kcal <= 840, 'c1 start 10–20 kcal/kg'); eq(alt('c1', 0).jc.status, 'ok', 'c1 3 cans ok'); }
// c2：急性期 3 瓶 990 kcal = 15.7 kcal/kg，<70% 中位數
{ const k = alt('c2', 0); eq(k.s.kcal, 990, 'c2 3 bottles'); eq(Math.round(k.s.kcal / 63 * 10) / 10, 15.7, 'c2 kcal/kg'); ok(k.s.kcal <= (1575 + 1890) / 2 * 0.7, 'c2 below 70%'); eq(Math.round(63 * 12), 756, 'c2 12 kcal/kg'); eq(Math.round((1575 + 1890) / 2 * 0.7), 1213, 'c2 70%'); }
// c3：只有主處方兩者皆達標；安素 Ex 3+乳清 10 差一點
{ const k = caseCalc(CC('c3').x, CC('c3').rx, ONS); eq([k.jc.status, k.jp.status], ['ok', 'ok'], 'c3 both ok'); CC('c3').alts.forEach((r, i) => ok(alt('c3', i).jp.status === 'low', 'c3 alt low protein ' + i)); eq(alt('c3', 0).s.pro, 80, 'c3 80 g'); eq(Math.round(k.t.adjusted * 1.3), 82, 'c3 ESPEN 82 g'); eq(Math.round(k.t.adjusted * 25), 1584, 'c3 adj 25'); eq(k.t.fluid.ml, 1900, 'c3 adj 30'); }
// c4
{ const k = caseCalc(CC('c4').x, CC('c4').rx, ONS); eq([k.jc.status, k.jp.status], ['ok', 'ok'], 'c4 ok'); eq(alt('c4', 0).s.pro, 34, 'c4 LPF 34 g'); eq(alt('c4', 0).jp.status, 'low', 'c4 LPF low'); ok(alt('c4', 1).recs.some(r => r.level === 'warn' && /高蛋白配方/.test(r.html)), 'c4 普寧勝 warn'); eq(alt('c4', 2).s.pro, 84, 'c4 DM 84 g'); eq(Math.round(84 / 46 * 10) / 10, 1.8, 'c4 DM ratio'); eq(k.t.fluid.ml - k.s.water, 1076, 'c4 free water'); const up = T(Object.assign({}, CC('c4').x, { setting: 'ward', specialty: 'sepsis' })); eq([up.pro.lo, up.pro.hi], [70, 87], 'c4 sepsis protein'); }
// c5
{ const k = caseCalc(CC('c5').x, CC('c5').rx, ONS); eq([k.jc.status, k.jp.status], ['ok', 'ok'], 'c5 ok'); eq(alt('c5', 0).s.pro, 64.2, 'c5 完膳'); eq(alt('c5', 0).jp.status, 'high', 'c5 完膳 high'); eq(alt('c5', 1).jp.status, 'low', 'c5 腎補納 low'); eq(k.s.water + 180, 678, 'c5 water + flush'); }
// c6
{ const k = caseCalc(CC('c6').x, CC('c6').rx, ONS); eq([k.jc.status, k.jp.status], ['ok', 'ok'], 'c6 ok'); eq(alt('c6', 0).jc.status, 'low', 'c6 佳易得 low'); ok(alt('c6', 1).recs.some(r => r.level === 'warn' && /非完整營養/.test(r.html)), 'c6 基速得 warn'); eq(k.t.fluid.ml - k.s.water, 550, 'c6 free water'); ok(k.recs.some(r => /連續滴注/.test(r.html)), 'c6 pump'); }

// 考題：結構
eq(QUIZ.length, 20, '20 questions');
eq([QUIZ.filter(q => q.l === 'basic').length, QUIZ.filter(q => q.l === 'adv').length], [10, 10], '10 + 10');
eq([0, 1, 2, 3].map(n => QUIZ.filter(q => q.a === n).length), [5, 5, 5, 5], 'A–D 5 each');
QUIZ.forEach((q, i) => { eq(q.o.length, 4, 'Q' + (i + 1) + ' options'); eq(new Set(q.o).size, 4, 'Q' + (i + 1) + ' unique'); ok(q.x && q.src, 'Q' + (i + 1) + ' explained'); });
const ans = i => QUIZ[i - 1].o[QUIZ[i - 1].a];
// 考題：答案對引擎
const r1t = v => Math.round(v * 10) / 10;
eq(ans(1), `${ONS.ibwOf('female', 160)} kg`, 'Q1');
ok(ans(2).startsWith(String(r1t(T({ weight: 90 }).doseW))), 'Q2');
eq(ans(3), `${T({ weight: 50 }).kcal.lo} kcal`, 'Q3');
eq(ans(4), `${T({ specialty: 'burn' }).pro.perLo.toFixed(1)}–${T({ specialty: 'burn' }).pro.perHi.toFixed(1)} g/kg`, 'Q4');
eq(ans(5), `${T({ renal: 'ckd35' }).pro.perLo}–${T({ renal: 'ckd35' }).pro.perHi} g/kg`, 'Q5');
eq(ONS.judge(1320, 1500, 1800).pct + '%', ans(8), 'Q8');
eq(ans(10), `${T({}).fluid.ml} mL`, 'Q10');
const ob38 = { setting: 'icu', gender: 'female', height: 158, weight: 95 };
eq(ans(11), `${T(ob38).kcal.lo}–${T(ob38).kcal.hi} kcal`, 'Q11');
eq(ans(12), `${T({ ...ob38, renal: 'crrt' }).pro.lo}–${T({ ...ob38, renal: 'crrt' }).pro.hi} g`, 'Q12');
eq(ans(13), `${Math.round(T(ob38).adjusted * 1.3)} g`, 'Q13');
eq(ans(14), `${42 * 10}–${42 * 20} kcal`, 'Q14');
ok(!T({ weight: 62 }).notes.some(n => /再餵食/.test(n)), 'Q15 no refeeding note at weight ≥ IBW');
ok(T({ weight: 50 }).notes.some(n => /再餵食/.test(n)), 'Q15 note below IBW');
{ const up = T({ renal: 'ckd35', specialty: 'sepsis' }); eq([up.pro.perLo, up.pro.perHi], [1.2, 1.5], 'Q16'); ok(ans(16).includes('1.2–1.5'), 'Q16 text'); }
ok(has(levels({ ventilator: 'hypercapnia' }), /過度餵食/), 'Q17');
{ const a = ONS.supply({ productId: '2814039', canCal: 478, canPro: 19.9, canCount: 3 }), b = ONS.supply({ productId: '2814162', canCal: 251, canPro: 8.8, canCount: 6 }); eq([a.kcal, a.water, b.water], [1434, 498, 1260], 'Q18'); }
ok(ans(20).includes('990'), 'Q20');

// 心智圖
eq(MAP.length, 8, 'map branches');
ok(MAP_ROOT.includes('評估'), 'map root');
const mapText = JSON.stringify(MAP);
['11–14 kcal/kg 實際體重', '22–25 kcal/kg IBW', '0.6–0.8 g/kg', '1.5–2.5 g/kg', '10–20 kcal/kg', '0.3–0.5 g/kg/日', '140 或 150–180'].forEach(s => ok(mapText.includes(s), 'map has ' + s));
ok(MAP.some(b => b.products), 'map product branch');

// 頁面結構
['tab-tool', 'tab-cases', 'tab-quiz', 'tab-map', 'case-body', 'quiz-body', 'map-body'].forEach(id => ok(html.includes(`id="${id}"`), 'html has ' + id));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
