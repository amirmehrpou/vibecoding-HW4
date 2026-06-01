/* ===================================================================
   سلطهٔ جهانی (World Dominion) — منطق بازی (جاوااسکریپت خالص)
   دو بازیکن، یک دستگاه، به‌نوبت. قوانین در پنجرهٔ «قوانین بازی».
   =================================================================== */

"use strict";

/* ---------- پیکربندی ---------- */
const API_URL =
  "https://restcountries.com/v3.1/all?fields=name,flags,capital,region,population";
const STARTING_HAND = 5;
const WIN_SCORE = 10;
const WIN_CAPTURES = 10;

/* رنگ نوار کناریِ کارت بر اساس منطقه. */
const REGION_COLORS = {
  Africa: "#d98a3d",
  Americas: "#3da27a",
  Asia: "#c0504d",
  Europe: "#4d7bc0",
  Oceania: "#3aa7b0",
  Antarctic: "#8c9aa5",
};

/* نام فارسی مناطق برای نمایش (منطق بازی همان نام انگلیسیِ API را نگه می‌دارد). */
const REGION_FA = {
  Africa: "آفریقا",
  Americas: "آمریکا",
  Asia: "آسیا",
  Europe: "اروپا",
  Oceania: "اقیانوسیه",
  Antarctic: "جنوبگان",
};
const NO_CAPITAL = "No capital"; // مقدار داخلی؛ در نمایش «بدون پایتخت» نشان داده می‌شود

/* ---------- وضعیت بازی ---------- */
let allCountries = []; // استخر کارت‌های ذخیره‌شده (تا «شروع دوباره» نیازی به دریافت مجدد نباشد)
let state = null; // وضعیت فعال بازی
let resolving = false; // هنگام حل/انیمیشن نبرد true می‌شود
let cardSeq = 0; // تولیدکنندهٔ شناسهٔ یکتای کارت

/* ---------- ارجاع به عناصر صفحه ---------- */
const $ = (id) => document.getElementById(id);
const dom = {
  loading: $("loadingOverlay"),
  error: $("errorOverlay"),
  errorMsg: $("errorMsg"),
  winner: $("winnerOverlay"),
  rules: $("rulesOverlay"),
  newCardToast: $("newCardToast"),
  hint: $("hint"),
  turnValue: $("turnValue"),
  turnIndicator: $("turnIndicator"),
  deckCount: $("deckCount"),
  endTurnBtn: $("endTurnBtn"),
  rulesBtn: $("rulesBtn"),
  restartBtn: $("restartBtn"),
  retryBtn: $("retryBtn"),
  playAgainBtn: $("playAgainBtn"),
  rulesClose: $("rulesClose"),
  rulesGotIt: $("rulesGotIt"),
  battleArea: $("battleArea"),
  battleLog: $("battleLog"),
  slotAtk: $("slot-attacker-card"),
  slotDef: $("slot-defender-card"),
};

/* ===================================================================
   ابزارها
   =================================================================== */

/* فرمول قدرت: floor(log10(جمعیت)). مثلاً ۱٬۰۰۰٬۰۰۰ ← ۶ */
function powerOf(population) {
  return Math.floor(Math.log10(population));
}

/* عدد با جداکنندهٔ هزارگان. */
function withCommas(n) {
  return n.toLocaleString("en-US");
}

/* فرار دادن متن برای درج امن در HTML (نام کشورها/پایتخت‌ها از API می‌آیند). */
function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
  );
}

/* بُر زدن فیشر–ییتس (در جا). */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* حرف اولِ پایتخت با حروف بزرگ؛ اگر پایتختی نباشد null. */
function capitalLetter(card) {
  if (!card.capital || card.capital === NO_CAPITAL) return null;
  const ch = card.capital.trim().charAt(0);
  if (!ch) return null;
  return ch.toUpperCase();
}

/* نگاشت حرف اول پایتخت به یکی از چهار بازهٔ توانایی. */
function abilityBand(letter) {
  if (!letter) return null;
  if (letter >= "A" && letter <= "F") return "AF"; // مهاجم +۱ حمله
  if (letter >= "G" && letter <= "L") return "GL"; // مدافع +۱ دفاع
  if (letter >= "M" && letter <= "R") return "MR"; // صاحب کارت ۱ کارت اضافه می‌کشد
  if (letter >= "S" && letter <= "Z") return "SZ"; // اگر برنده شد +۱ امتیاز
  return null; // غیرلاتین/نماد ← بدون توانایی
}

/* اطلاعات نمایشیِ هر توانایی (مکانیک تغییری نمی‌کند؛ فقط برای خوانایی).
   توانایی همچنان از حرف اولِ پایتخت می‌آید. */
const ABILITY = {
  AF: { emoji: "⚔️", title: "کشور مهاجم", desc: "+۱ هنگام حمله", cls: "ab-attack" },
  GL: { emoji: "🛡️", title: "کشور مدافع", desc: "+۱ هنگام دفاع", cls: "ab-defense" },
  MR: { emoji: "🎴", title: "کشور پشتیبان", desc: "کشیدن ۱ کارت پس از نبرد", cls: "ab-reinforce" },
  SZ: { emoji: "⭐", title: "کشور افتخار", desc: "+۱ امتیاز هنگام برد", cls: "ab-glory" },
};
const ABILITY_NONE = { emoji: "—", title: "بدون توانایی", desc: "این کارت توانایی ویژه ندارد", cls: "ab-none" };

/* توانایی یک کارت بر اساس حرف اولِ پایتختش. */
function abilityInfo(card) {
  const band = abilityBand(capitalLetter(card));
  return band ? { band, ...ABILITY[band] } : { band: null, ...ABILITY_NONE };
}

/* پاداش منطقه: +۱ با ۲ کارت یا بیشتر، +۲ با ۳ کارت یا بیشتر. */
function regionBonus(hand, region) {
  const count = hand.filter((c) => c.region === region).length;
  if (count >= 3) return 2;
  if (count >= 2) return 1;
  return 0;
}

/* نمایش فارسی نام منطقه. */
function regionLabel(region) {
  return REGION_FA[region] || region;
}

/* ===================================================================
   بارگذاری داده‌ها
   =================================================================== */

async function loadCountries() {
  showOverlay("loading");
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const raw = await res.json();

    // پالایش: باید name.common، flags، region و population > 0 داشته باشد.
    allCountries = raw
      .filter(
        (c) =>
          c &&
          c.name &&
          c.name.common &&
          c.flags &&
          (c.flags.png || c.flags.svg) &&
          c.region &&
          typeof c.population === "number" &&
          c.population > 0
      )
      .map((c) => ({
        name: c.name.common,
        flag: c.flags.png || c.flags.svg,
        capital:
          Array.isArray(c.capital) && c.capital.length ? c.capital[0] : NO_CAPITAL,
        region: c.region,
        population: c.population,
        power: powerOf(c.population),
      }));

    if (allCountries.length < STARTING_HAND * 2 + 4) {
      throw new Error("دادهٔ کافی از کشورها دریافت نشد.");
    }

    hideOverlay("error");
    startNewGame();
  } catch (err) {
    console.error("بارگذاری کشورها ناموفق بود:", err);
    dom.errorMsg.textContent =
      "دسترسی به اطلاعات جهانی ممکن نشد (" +
      (err.message || "خطای شبکه") +
      "). اتصال اینترنت را بررسی کن و دوباره تلاش کن.";
    showOverlay("error");
  }
}

/* ===================================================================
   آماده‌سازی بازی
   =================================================================== */

/* ساخت دستهٔ تازه از کارت‌های ذخیره‌شده و پخش یک بازی جدید. */
function startNewGame() {
  hideOverlay("loading");
  hideOverlay("error");
  hideOverlay("winner");

  // کپی و بُر زدن استخر ذخیره‌شده تا هر بازی تازه باشد.
  // هر کارت یک وضعیت خستگی دارد (exhausted): در شروع، همه آماده‌اند.
  const deck = shuffle(
    allCountries.map((c) => ({ ...c, uid: ++cardSeq, exhausted: false }))
  );

  const players = [
    { name: "بازیکن ۱", score: 0, hand: [], captured: [] },
    { name: "بازیکن ۲", score: 0, hand: [], captured: [] },
  ];

  // پخش ۵ کارت به هر بازیکن.
  for (let i = 0; i < STARTING_HAND; i++) {
    players[0].hand.push(deck.pop());
    players[1].hand.push(deck.pop());
  }

  state = {
    deck,
    players,
    current: 0, // بازیکن ۱ شروع می‌کند
    attacker: null, // شناسهٔ کارت مهاجمِ انتخاب‌شده
    defender: null, // شناسهٔ کارت مدافعِ انتخاب‌شده
    over: false,
  };

  resolving = false;
  render();
  // نوبتِ بازیکن ۱ آغاز می‌شود (یک کارت خودکار کشیده و اعلام می‌شود).
  startTurn();
}

/* ===================================================================
   شروع نوبت — کشیدن خودکارِ یک کارت و اعلام آن
   =================================================================== */

/* در شروعِ هر نوبت:
   - کارت‌های خستهٔ این بازیکن دوباره آماده می‌شوند (قانون خستگی).
   - یک کارت به‌طور خودکار از دسته به این بازیکن داده می‌شود (به‌جای دکمهٔ کشیدن).
   - کارتِ جدید به بازیکن اعلام می‌شود. */
function startTurn() {
  state.attacker = null;
  state.defender = null;
  refreshReady(state.current);

  // کشیدن خودکارِ یک کارت برای بازیکنِ نوبت‌دار (در صورت وجود کارت در دسته).
  let drawn = null;
  if (state.deck.length > 0) {
    drawn = state.deck.pop();
    curPlayer().hand.push(drawn);
  }

  // ایمنیِ پایان بازی (مثلاً دسته خالی و یک بازیکن بدون کارت).
  const result = determineWinner();
  if (result) {
    state.over = true;
    render();
    showWinner(result);
    return;
  }

  render();

  if (drawn) {
    announceNewCard(curPlayer(), drawn);
    setHint(
      "نوبتِ " + curPlayer().name +
      " — یک کارت از دستِ خودت و یک کارت از حریف انتخاب کن تا نبرد شود."
    );
  } else {
    setHint(
      "نوبتِ " + curPlayer().name +
      " — دسته خالی است. یک کارت از خودت و یک کارت از حریف انتخاب کن."
    );
  }
}

/* اعلامِ «کارت جدیدِ تو» به‌صورت یک نوار کوتاه که خودش محو می‌شود. */
let toastTimer = null;
function announceNewCard(player, card) {
  const toast = dom.newCardToast;
  toast.innerHTML = "";

  const label = document.createElement("div");
  label.className = "toast-label";
  label.textContent = "کارت جدیدِ " + player.name + ":";

  const preview = buildCard(card); // نمایش کاملِ کارتِ جدید

  const close = document.createElement("button");
  close.className = "toast-close";
  close.setAttribute("aria-label", "بستن");
  close.innerHTML = "&times;";
  close.addEventListener("click", hideNewCardToast);

  toast.append(close, label, preview);
  toast.classList.remove("hidden");
  // اجازه می‌دهیم انیمیشن ورود اجرا شود.
  requestAnimationFrame(() => toast.classList.add("show"));

  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideNewCardToast, 3600);
}
function hideNewCardToast() {
  clearTimeout(toastTimer);
  dom.newCardToast.classList.remove("show");
  // پس از پایان انیمیشن، پنهانش می‌کنیم.
  setTimeout(() => dom.newCardToast.classList.add("hidden"), 300);
}

/* دسترسی‌های کمکی. */
const curPlayer = () => state.players[state.current];
const oppPlayer = () => state.players[1 - state.current];
const findCard = (player, uid) => player.hand.find((c) => c.uid === uid) || null;

/* قانون خستگی: در شروع نوبتِ یک بازیکن، همهٔ کارت‌های خسته‌اش دوباره آماده می‌شوند. */
function refreshReady(playerIndex) {
  state.players[playerIndex].hand.forEach((c) => {
    c.exhausted = false;
  });
}

/* ===================================================================
   نمایش
   =================================================================== */

function render() {
  if (!state) return;

  // نشانگر نوبت و شمارندهٔ دسته.
  dom.turnValue.textContent = curPlayer().name;
  dom.turnIndicator.classList.toggle("p1-turn", state.current === 0);
  dom.turnIndicator.classList.toggle("p2-turn", state.current === 1);
  dom.deckCount.textContent = state.deck.length;

  // درخشش بازیکنِ نوبت‌دار.
  $("area-0").classList.toggle("active", state.current === 0);
  $("area-1").classList.toggle("active", state.current === 1);

  // پنل هر بازیکن.
  for (let p = 0; p < 2; p++) {
    const pl = state.players[p];
    $("name-" + p).textContent = pl.name;
    $("score-" + p).textContent = pl.score;
    $("capcount-" + p).textContent = pl.captured.length;
    renderHand(p);
    renderCaptured(p);
  }

  // وضعیت دکمه‌ها.
  const blocked = resolving || state.over;
  dom.endTurnBtn.disabled = blocked;
  dom.restartBtn.disabled = false;

  renderBattleSlots();
}

/* نمایش دست یک بازیکن (کارت‌ها همیشه رو هستند).
   - دستِ بازیکنِ نوبت‌دار: قابل انتخاب به‌عنوان مهاجم (با رعایت خستگی).
   - دستِ حریف: قابل انتخاب به‌عنوان مدافع. */
function renderHand(p) {
  const wrap = $("hand-" + p);
  wrap.innerHTML = "";
  const pl = state.players[p];
  const isCurrent = p === state.current;
  const labelEl = $("handlabel-" + p);
  const selectable = !resolving && !state.over;

  if (labelEl) labelEl.textContent = isCurrent ? "دستِ شما" : "دستِ حریف";

  pl.hand.forEach((card) => {
    const el = buildCard(card);
    // بازیکنِ نوبت‌دار مهاجم انتخاب می‌کند؛ حریف هدفِ مدافع است.
    const role = isCurrent ? "attacker" : "defender";
    // قانون خستگی: کارتِ خسته نمی‌تواند مهاجم باشد (اما می‌تواند مدافع/هدف باشد).
    const canPick = selectable && !(role === "attacker" && card.exhausted);

    if (canPick) {
      el.classList.add("selectable");
      el.addEventListener("click", () => onCardClick(card, role));
    }

    if (state.attacker === card.uid && isCurrent) el.classList.add("sel-attacker");
    if (state.defender === card.uid && !isCurrent) el.classList.add("sel-defender");

    wrap.appendChild(el);
  });
}

/* نمایش کشورهای تسخیرشده (کارت‌های کوچک‌تر). */
function renderCaptured(p) {
  const wrap = $("captured-" + p);
  wrap.innerHTML = "";
  state.players[p].captured.forEach((card) => {
    wrap.appendChild(buildCard(card, true));
  });
}

/* ساخت عنصر کارت کشور. mini ← سبکِ کوچکِ تسخیرشده. */
function buildCard(card, mini = false) {
  const el = document.createElement("div");
  el.className = "card" + (mini ? " mini" : "") + (card.exhausted ? " exhausted" : "");
  el.dataset.uid = card.uid;
  const capLabel = card.capital === NO_CAPITAL ? "بدون پایتخت" : card.capital;
  el.title = card.name + " — " + capLabel;

  const strip = document.createElement("div");
  strip.className = "region-strip";
  strip.style.background = REGION_COLORS[card.region] || "#8c9aa5";

  const power = document.createElement("div");
  power.className = "card-power";
  power.textContent = card.power;

  const flagWrap = document.createElement("div");
  flagWrap.className = "card-flag-wrap";
  const img = document.createElement("img");
  img.loading = "lazy";
  img.alt = "پرچم " + card.name;
  img.src = card.flag;
  flagWrap.appendChild(img);

  const body = document.createElement("div");
  body.className = "card-body";

  const name = document.createElement("div");
  name.className = "card-name";
  name.textContent = card.name;
  body.appendChild(name);

  if (!mini) {
    body.appendChild(cardRow("منطقه", regionLabel(card.region)));
    body.appendChild(cardRow("جمعیت", withCommas(card.population)));
    // پایتخت درست بالای بخش توانایی نمایش داده می‌شود تا پیوندشان روشن باشد.
    body.appendChild(buildAbilitySection(card, capLabel));
  }

  // نشانگر وضعیت آماده/خسته (فقط روی کارت‌های دست، نه کارت‌های تسخیرشده).
  if (!mini) {
    const status = document.createElement("div");
    status.className = "card-status " + (card.exhausted ? "is-exhausted" : "is-ready");
    status.textContent = card.exhausted ? "خسته" : "آماده";
    el.appendChild(status);
  }

  el.append(strip, power, flagWrap, body);
  return el;
}

function cardRow(label, value) {
  const row = document.createElement("div");
  row.className = "card-row";
  const lbl = document.createElement("span");
  lbl.className = "lbl";
  lbl.textContent = label;
  const val = document.createElement("span");
  val.className = "val";
  val.textContent = value;
  row.append(lbl, val);
  return row;
}

/* بخش «پایتخت + بنر توانایی» در پایین کارت.
   پایتخت بالای بنر می‌آید تا بازیکن بدون باز کردن قوانین بفهمد کارت چه می‌کند. */
function buildAbilitySection(card, capLabel) {
  const info = abilityInfo(card);
  const sec = document.createElement("div");
  sec.className = "ability";

  // خطِ پایتخت (همیشه دیده می‌شود — بخشی از هویت بازی است).
  const cap = document.createElement("div");
  cap.className = "ability-capital";
  const capWord = document.createElement("span");
  capWord.textContent = "پایتخت: ";
  const capName = document.createElement("b");
  capName.textContent = capLabel;
  cap.append(capWord, capName);

  // بنر رنگیِ توانایی.
  const banner = document.createElement("div");
  banner.className = "ability-banner " + info.cls;
  const emoji = document.createElement("span");
  emoji.className = "ab-emoji";
  emoji.textContent = info.emoji;
  const title = document.createElement("span");
  title.className = "ab-title";
  title.textContent = info.title;
  banner.append(emoji, title);

  // توضیح کوتاه زیر بنر.
  const desc = document.createElement("div");
  desc.className = "ability-desc";
  desc.textContent = info.desc;

  sec.append(cap, banner, desc);
  return sec;
}

/* نمایش دو رزمنده (یا جای خالی) در میدان نبرد. */
function renderBattleSlots() {
  dom.slotAtk.innerHTML = "";
  dom.slotDef.innerHTML = "";

  const atk = state.attacker ? findCard(curPlayer(), state.attacker) : null;
  const def = state.defender ? findCard(oppPlayer(), state.defender) : null;

  if (atk) dom.slotAtk.appendChild(buildCard(atk));
  if (def) dom.slotDef.appendChild(buildCard(def));
}

/* ===================================================================
   تعامل بازیکن
   =================================================================== */

function onCardClick(card, role) {
  if (resolving || state.over) return;

  if (role === "attacker") {
    // انتخاب/لغو مهاجم.
    state.attacker = state.attacker === card.uid ? null : card.uid;
  } else {
    state.defender = state.defender === card.uid ? null : card.uid;
  }

  render();

  // به‌محض انتخاب هم مهاجم و هم مدافع، نبرد خودکار حل می‌شود.
  if (state.attacker && state.defender) {
    setHint("رزمندگان انتخاب شدند — در حال حل نبرد…");
    resolveBattle();
  } else if (state.attacker) {
    setHint(curPlayer().name + "، حالا یک کارت از دستِ حریف به‌عنوان مدافع انتخاب کن.");
  } else if (state.defender) {
    setHint(curPlayer().name + "، یکی از کارت‌های خودت را به‌عنوان مهاجم انتخاب کن.");
  } else {
    setHint("نوبتِ " + curPlayer().name + ".");
  }
}

/* پایان نوبت بازیکن فعلی: تعویض طرف و آغاز نوبتِ بازیکن بعدی. */
function endTurn() {
  if (resolving || state.over) return;
  state.current = 1 - state.current;
  startTurn(); // نوبتِ بازیکن بعدی (کشیدن خودکار + اعلام کارت)
}

/* ===================================================================
   حل نبرد
   =================================================================== */

/* ساخت گزارش نبرد به‌صورت HTML — دقیقاً نشان می‌دهد چه پاداش‌هایی اعمال شده. */
function buildBattleLog(d) {
  const side = (label, card, base, region, capBonus, capSources, final, ownBand) => {
    const info = ownBand ? ABILITY[ownBand] : ABILITY_NONE;
    const cap = card.capital === NO_CAPITAL ? "بدون پایتخت" : card.capital;
    let rows = "";
    rows += "<div>پایهٔ قدرت: <b>" + base + "</b></div>";
    rows +=
      '<div>توانایی: <span class="ab-chip ' + info.cls + '">' +
      info.emoji + " " + escapeHtml(info.title) + "</span></div>";
    rows += "<div>پاداش منطقه: <b>" + (region > 0 ? "+" + region : "۰") + "</b></div>";
    if (capBonus > 0) {
      rows +=
        "<div>پاداش پایتخت: <b>+" + capBonus + "</b> " +
        '<span class="log-src">(' + capSources.map(escapeHtml).join("، ") + ")</span></div>";
    }
    return (
      '<div class="log-side">' +
      '<div class="log-tag">' + label + "</div>" +
      '<div class="log-name">' + escapeHtml(card.name) +
      ' <span class="log-cap">(' + escapeHtml(cap) + ")</span></div>" +
      '<div class="log-rows">' + rows + "</div>" +
      '<div class="log-final">قدرت نهایی: <b>' + final + "</b></div>" +
      "</div>"
    );
  };

  const atkOwn = abilityBand(capitalLetter(d.atkCard));
  const defOwn = abilityBand(capitalLetter(d.defCard));

  const grid =
    '<div class="log-grid">' +
    side("مهاجم", d.atkCard, d.atkBase, d.atkRegion, d.atkCapBonus, d.atkCapSources, d.atkFinal, atkOwn) +
    side("مدافع", d.defCard, d.defBase, d.defRegion, d.defCapBonus, d.defCapSources, d.defFinal, defOwn) +
    "</div>";

  const resultLine = d.attackerWins
    ? '<div class="log-result win">نتیجه: ' + escapeHtml(d.attacker.name) +
      " کشورِ " + escapeHtml(d.defCard.name) + " را تسخیر کرد.</div>"
    : '<div class="log-result lose">نتیجه: ' + escapeHtml(d.defCard.name) +
      " با موفقیت دفاع کرد — " + escapeHtml(d.defender.name) + " امتیاز گرفت.</div>";

  const extrasHTML = d.extras.length
    ? '<div class="log-extras">' +
      d.extras.map((e) => "<div>" + escapeHtml(e) + "</div>").join("") +
      "</div>"
    : "";

  return grid + resultLine + extrasHTML;
}

function resolveBattle() {
  resolving = true;
  render(); // قفل کردن دکمه‌ها و انتخاب کارت هنگام حل نبرد

  const attacker = curPlayer();
  const defender = oppPlayer();
  const atkCard = findCard(attacker, state.attacker);
  const defCard = findCard(defender, state.defender);

  // ایمنی: اگر کارتی به‌هر دلیل ناپدید شد، تمیز خارج شو.
  if (!atkCard || !defCard) {
    resolving = false;
    state.attacker = null;
    state.defender = null;
    render();
    return;
  }

  // ---- پاداش منطقه (بر اساس دستِ فعلیِ هر صاحب) ----
  const atkRegion = regionBonus(attacker.hand, atkCard.region);
  const defRegion = regionBonus(defender.hand, defCard.region);

  // ---- توانایی پایتخت (هر دو کارت ارزیابی می‌شوند؛ مکانیک بدون تغییر) ----
  const atkBand = abilityBand(capitalLetter(atkCard)); // توانایی کارتِ مهاجم
  const defBand = abilityBand(capitalLetter(defCard)); // توانایی کارتِ مدافع

  let atkCapBonus = 0; // مجموع A–F (به قدرت حملهٔ مهاجم اضافه می‌شود)
  let defCapBonus = 0; // مجموع G–L (به قدرت دفاعِ مدافع اضافه می‌شود)
  const atkCapSources = []; // کدام پایتخت‌ها +۱ حمله دادند
  const defCapSources = []; // کدام پایتخت‌ها +۱ دفاع دادند

  [atkCard, defCard].forEach((card) => {
    const band = abilityBand(capitalLetter(card));
    if (band === "AF") {
      atkCapBonus += 1;
      atkCapSources.push(card.name);
    } else if (band === "GL") {
      defCapBonus += 1;
      defCapSources.push(card.name);
    }
  });

  const atkDrawsExtra = atkBand === "MR"; // M–R روی کارت مهاجم
  const defDrawsExtra = defBand === "MR"; // M–R روی کارت مدافع
  const atkScoreIfWin = atkBand === "SZ"; // S–Z روی کارت مهاجم
  const defScoreIfWin = defBand === "SZ"; // S–Z روی کارت مدافع

  // ---- قدرت نهایی ----
  const atkFinal = atkCard.power + atkRegion + atkCapBonus;
  const defFinal = defCard.power + defRegion + defCapBonus;

  // ---- تعیین نتیجه (مهاجم فقط با قدرتِ اکیداً بیشتر می‌برد؛ تساوی به نفع مدافع) ----
  const attackerWins = atkFinal > defFinal;

  // یادداشتِ پاداش‌های جانبی برای گزارش نبرد.
  const extras = [];

  if (attackerWins) {
    // حذف مدافعِ شکست‌خورده از دستِ حریف ← تسخیرشده‌های مهاجم.
    defender.hand = defender.hand.filter((c) => c.uid !== defCard.uid);
    attacker.captured.push(defCard);
    attacker.score += 1;
    if (atkScoreIfWin) {
      attacker.score += 1; // پاداش S–Z روی کارت مهاجم
      extras.push("⭐ افتخار: +۱ امتیاز برای " + attacker.name + " (پایتختِ " + atkCard.name + ").");
    }
  } else {
    // مدافع مقاومت می‌کند. هر دو کارت سرِ جایشان می‌مانند.
    defender.score += 1;
    if (defScoreIfWin) {
      defender.score += 1; // پاداش S–Z روی کارت مدافع
      extras.push("⭐ افتخار: +۱ امتیاز برای " + defender.name + " (پایتختِ " + defCard.name + ").");
    }
  }

  // ---- M–R: صاحبان کارت پس از نبرد ۱ کارت اضافه می‌کشند (اگر دسته اجازه دهد) ----
  if (atkDrawsExtra && state.deck.length > 0) {
    attacker.hand.push(state.deck.pop());
    extras.push("🎴 پشتیبانی: " + attacker.name + " به‌خاطر پایتختِ " + atkCard.name + " یک کارت کشید.");
  }
  if (defDrawsExtra && state.deck.length > 0) {
    defender.hand.push(state.deck.pop());
    extras.push("🎴 پشتیبانی: " + defender.name + " به‌خاطر پایتختِ " + defCard.name + " یک کارت کشید.");
  }

  // ---- قانون خستگی: کارتِ مهاجم پس از حمله همیشه «خسته» می‌شود ----
  // (مهاجم هرگز حذف نمی‌شود، پس همیشه زنده می‌ماند و خسته می‌گردد.)
  atkCard.exhausted = true;
  extras.push("💤 کارتِ " + atkCard.name + " خسته شد.");

  // ---- ساخت و نمایش گزارش نبرد ----
  const log = buildBattleLog({
    attacker,
    defender,
    atkCard,
    defCard,
    atkBase: atkCard.power,
    defBase: defCard.power,
    atkRegion,
    defRegion,
    atkCapBonus,
    defCapBonus,
    atkCapSources,
    defCapSources,
    atkFinal,
    defFinal,
    attackerWins,
    extras,
  });

  // ---- انیمیشن برخورد، نمایش گزارش، سپس پاک‌سازی ----
  dom.battleArea.classList.add("clashing");
  dom.battleLog.innerHTML = log;
  render(); // بازتاب فوری تغییرات امتیاز/دست/تسخیرشده/خستگی

  // پخش انیمیشن خسته‌شدن روی کارتِ مهاجم در دستِ بازیکن فعلی (نوبت هنوز عوض نشده).
  const atkUid = atkCard.uid;
  requestAnimationFrame(() => {
    const handWrap = $("hand-" + state.current);
    const cardEl = handWrap
      ? handWrap.querySelector('.card[data-uid="' + atkUid + '"]')
      : null;
    if (cardEl) cardEl.classList.add("exhausting");
  });

  setTimeout(() => dom.battleArea.classList.remove("clashing"), 520);

  // اکنون که امتیاز/تسخیرها به‌روز شده، برنده را بررسی کن.
  const result = determineWinner();

  setTimeout(() => {
    // پاک کردن میدان نبرد و انتخاب‌ها.
    state.attacker = null;
    state.defender = null;
    dom.battleLog.textContent = "یک مهاجم و سپس یک مدافع انتخاب کنید.";

    if (result) {
      state.over = true;
      resolving = false;
      render();
      showWinner(result);
      return;
    }

    // تعویض به بازیکن دیگر و آغاز نوبتش (کشیدن خودکار + اعلام کارت).
    state.current = 1 - state.current;
    resolving = false;
    startTurn();
  }, 1900);
}

/* ===================================================================
   شرایط برد
   =================================================================== */

/* وقتی بازی تمام شده باشد {idx, reason} برمی‌گرداند، وگرنه null.
   idx === -1 یعنی تساوی. */
function determineWinner() {
  const [p0, p1] = state.players;

  const p0Score = p0.score >= WIN_SCORE;
  const p1Score = p1.score >= WIN_SCORE;
  const p0Caps = p0.captured.length >= WIN_CAPTURES;
  const p1Caps = p1.captured.length >= WIN_CAPTURES;
  const handEmpty =
    state.deck.length === 0 && (p0.hand.length === 0 || p1.hand.length === 0);

  if (!p0Score && !p1Score && !p0Caps && !p1Caps && !handEmpty) {
    return null; // بازی ادامه دارد
  }

  // تعیین دلیلِ پایان بر اساس بالاترین اولویت.
  let reason = "کارتی برای بازی باقی نماند.";
  if (p0Score || p1Score) reason = "رسیدن به " + WIN_SCORE + " امتیاز.";
  else if (p0Caps || p1Caps) reason = "تسخیرِ " + WIN_CAPTURES + " کشور.";

  // برنده = امتیاز بیشتر، سپس تسخیر بیشتر، سپس تساوی.
  let idx;
  if (p0.score !== p1.score) idx = p0.score > p1.score ? 0 : 1;
  else if (p0.captured.length !== p1.captured.length)
    idx = p0.captured.length > p1.captured.length ? 0 : 1;
  else idx = -1; // تساوی

  return { idx, reason };
}

/* ===================================================================
   پنجره‌ها / راهنما
   =================================================================== */

function showOverlay(key) {
  const map = {
    loading: dom.loading,
    error: dom.error,
    winner: dom.winner,
    rules: dom.rules,
  };
  map[key].classList.remove("hidden");
}
function hideOverlay(key) {
  const map = {
    loading: dom.loading,
    error: dom.error,
    winner: dom.winner,
    rules: dom.rules,
  };
  map[key].classList.add("hidden");
}

function setHint(text) {
  dom.hint.textContent = text;
}

function showWinner(result) {
  const [p0, p1] = state.players;
  $("final-name-0").textContent = p0.name;
  $("final-name-1").textContent = p1.name;
  $("final-score-0").textContent = p0.score;
  $("final-score-1").textContent = p1.score;
  $("final-cap-0").textContent = p0.captured.length + " تسخیرشده";
  $("final-cap-1").textContent = p1.captured.length + " تسخیرشده";

  if (result.idx === -1) {
    $("winnerTitle").textContent = "بازی مساوی شد!";
  } else {
    $("winnerTitle").textContent = state.players[result.idx].name + " برنده شد!";
  }
  $("winnerReason").textContent = result.reason;

  showOverlay("winner");
  setHint("بازی تمام شد.");
}

/* ===================================================================
   اتصال رویدادها + راه‌اندازی
   =================================================================== */

dom.endTurnBtn.addEventListener("click", endTurn);
dom.restartBtn.addEventListener("click", () => {
  if (allCountries.length) startNewGame();
  else loadCountries();
});
dom.playAgainBtn.addEventListener("click", startNewGame);
dom.retryBtn.addEventListener("click", loadCountries);

// باز و بسته کردن پنجرهٔ قوانین.
dom.rulesBtn.addEventListener("click", () => showOverlay("rules"));
dom.rulesClose.addEventListener("click", () => hideOverlay("rules"));
dom.rulesGotIt.addEventListener("click", () => hideOverlay("rules"));
// بستن با کلیک روی پس‌زمینهٔ تیره یا کلید Escape.
dom.rules.addEventListener("click", (e) => {
  if (e.target === dom.rules) hideOverlay("rules");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideOverlay("rules");
});

// شروع همه‌چیز.
loadCountries();
