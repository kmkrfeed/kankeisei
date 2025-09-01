/* ===== TRPG 関係性蒐集機関 — Browser Game (Next only / strict line-by-line) =====
   ・文章は Next を押した分だけ1行ずつ表示（自動送りなし）。
   ・質問UIは質問の行が全部出終わった“後”に表示。未入力は Answer 不可。Skipあり。
   ・自由発言（Send）は「回答中でない＆終了前」なら常に送信可（Next待ち中でもOK）。
   ・キャラクター発言表記は「プレイヤー名：…」に統一。
   ・注意書きバナーはプレイ中は一切表示しない（出力時のみ付与）。
   ・エグジット後のみ HTML/ふせったー出力可。
===================================================================== */

// --- DOM ---
const startPanel = document.getElementById("startPanel");
const gamePanel  = document.getElementById("gamePanel");
const playerNameInput = document.getElementById("playerNameInput");
const targetNameInput  = document.getElementById("targetNameInput");
const btnStart   = document.getElementById("btnStart");

const logDiv     = document.getElementById("log");
const sceneTitle = document.getElementById("sceneTitle");

const navActions       = document.getElementById("navActions");
const formArea   = document.getElementById("formArea");
const formFields = document.getElementById("formFields");
const btnSubmit  = document.getElementById("btnSubmit");
const btnSkip    = document.getElementById("btnSkip");
const noticeBox  = document.getElementById("noticeBox"); // プレイ中は非表示

const chatArea   = document.getElementById("chatArea");
const chatInput  = document.getElementById("chatInput");
const btnChat    = document.getElementById("btnChat");

const exportActions    = document.getElementById("exportActions");
const btnExportHtml = document.getElementById('btnExportHtml');
const btnExportFusetter = document.getElementById('btnExportFusetter');
const statusEl          = document.getElementById("status");
const btnEntranceSkip = document.getElementById("btnEntranceSkip");

// ===== Blob を保存する共通関数（常にグローバルに生やす） =====
if (!window.downloadBlob) {
  window.downloadBlob = function(blob, filename){
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a); // Safari対策
    a.click();
    a.remove();
    // revokeは少し遅らせる（Safari対策）
    setTimeout(()=> URL.revokeObjectURL(url), 1000);
  };
}

function updateExportButtons(){
  const show = !!STATE.finished;
  btnExportHtml.hidden = !show;
  btnExportFusetter.hidden = !show;
  btnExportHtml.disabled = !show;
  btnExportFusetter.disabled = !show;
}

function finalizeSession(){
  STATE.endedAt = new Date();
  STATE.finished = true;

  refreshChat();           // 終了後はチャット不可（あなたの仕様）
  updateExportButtons();   // 出力ボタンを表示＆有効化
  updateNextAvailability();
}


function isMobile(){
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// 表示切替直後に万一フォーカスされた入力があれば外す（iOS対策で遅延blurも）
function preventMobileKeyboard(){
  if(!isMobile()) return;
  const ae = document.activeElement;
  if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)){
    ae.blur();
    setTimeout(()=> {
      const a2 = document.activeElement;
      if (a2 && (a2.tagName === "INPUT" || a2.tagName === "TEXTAREA" || a2.isContentEditable)){
        a2.blur();
      }
    }, 50);
  }
}


function showEndExportButtons(){
  // ① プレイ中の操作は隠す
  if (formArea)   formArea.hidden = true;
  if (chatArea)   chatArea.hidden = true;
  if (navActions) navActions.hidden = true;

  // ② エクスポート用の置き場を表示
  if (exportActions) exportActions.hidden = false;

  // ③ ヘッダーにある出力ボタンをここへ移動＆有効化
  if (btnExportHtml){
    btnExportHtml.hidden   = false;
    btnExportHtml.disabled = false;
    exportActions.appendChild(btnExportHtml);
  }
  if (btnExportFusetter){
    btnExportFusetter.hidden   = false;
    btnExportFusetter.disabled = false;
    exportActions.appendChild(btnExportFusetter);
  }
}

async function finalizeAfterQueue(){
  if (STATE.finished) return;   // 二重呼び出し防止
  await waitQueueEmpty();       // 最後の文が出終わるのを待つ

  STATE.endedAt = new Date();
  STATE.finished = true;

  refreshChat();
  updateNextAvailability();
  showEndExportButtons();       // ← UI 切替はここ
}


// ラベル/クラス統一
if (btnChat) btnChat.textContent = "Send";

// Next（ログの下・回答欄の上・右寄せ）
let btnNext = document.getElementById("btnNext");
(function ensureAndPlaceNext(){
  if(!btnNext){
    btnNext = document.createElement("button");
    btnNext.id = "btnNext";
    btnNext.textContent = "Next ▶";
  }
  btnNext.className = "btn-secondary";

  // ← ここを変更：.form-actions 内に収める
  const nav = document.querySelector("#gamePanel .form-actions");
  if (nav) {
    nav.appendChild(btnNext);
    btnNext.hidden = false;
    // フレックス任せにするのでインラインstyleはクリア
    btnNext.style.display = "";
    btnNext.style.margin = "";
  } else {
    // フォールバック（万一 .form-actions が無い場合）
    const parent = formArea.parentElement || logDiv.parentElement || document.body;
    parent.insertBefore(btnNext, formArea);
    btnNext.hidden = false;
  }
})();

// --- STATE ---
const STATE = {
  player: "", target: "",
  timeline: null,         // "current" | "past"
  valence:  null,         // "pos" | "neutral" | "neg"
  step: 0,
  answers: {},            // roomKey -> {room,q,a,extra}
  log: [],
  startedAt: null,
  endedAt: null,
  awaitingAnswer: false,
  finished: false
};

// [ADD] 《${STATE.target}》 や ${STATE.target}、{{target}}、同様に player も一括展開
function expandTargetVars(s){
  if(!s) return s;
  const t = (STATE?.target || '').toString();
  const p = (STATE?.player || '').toString();
  return s
    // target 用
    .replace(/《\s*\$\{STATE\.target\}\s*》/g, `《${t}》`)
    .replace(/\$\{\s*STATE\.target\s*\}/g, t)
    .replace(/\{\{\s*target\s*\}\}/gi, t)
    .replace(/《\s*TARGET\s*》/gi, `《${t}》`)
    // player 用
    .replace(/《\s*\$\{STATE\.player\}\s*》/g, `《${p}》`)
    .replace(/\$\{\s*STATE\.player\s*\}/g, p)
    .replace(/\{\{\s*player\s*\}\}/gi, p)
    .replace(/《\s*PLAYER\s*》/gi, `《${p}》`);
}



// --- 表示キュー（Nextで1行ずつ） ---
const SHOW = { queue: [], waiters: [] };

// ===== Helpers =====
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])) }
function fmtDT(d){ if(!d) return ""; const pad=n=>String(n).padStart(2,"0"); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function flash(msg){ statusEl.textContent=msg; setTimeout(()=>statusEl.textContent="",1800); }

function addLine(text, cls="sys"){
  const p = document.createElement("div");
  p.className = "line " + cls;

  const expanded = expandTargetVars(String(text || ""));
  const escaped  = escapeHtml(expanded)
    .replace(/\n/g, "<br>")       // ← 改行→<br>
    .replace(/&lt;br&gt;/g,"<br>"); // ← 文字列の <br> も有効化

  p.innerHTML = escaped;
  logDiv.appendChild(p);
  logDiv.scrollTop = logDiv.scrollHeight;
  STATE.log.push({ cls, text: expanded });
}


function addRoomTitle(title){ addLine(`【${title}】`, "room"); }

function appendMultilineText(el, s){
  const parts = String(s || "").split(/\r?\n/);
  for (let i = 0; i < parts.length; i++){
    if(i>0) el.appendChild(document.createElement("br"));
    el.appendChild(document.createTextNode(parts[i])); // ←テキストノードなので安全
  }
}


function addPcLine(text){
  const p = document.createElement("div");
  p.className = "line pc";

  // ★ここで行全体の文字色を指定
  p.style.color = STATE.playerColor || "#ffffff";
  p.style.fontWeight = "700";  // 太さも行全体に

  // 回答者名プレフィックス
  const name = document.createTextNode(`${STATE.player}：`);
  p.appendChild(name);

  // セリフ本文（改行処理付き）
  const expanded = expandTargetVars(String(text || ""));
  appendMultilineText(p, expanded);

  logDiv.appendChild(p);
  logDiv.scrollTop = logDiv.scrollHeight;

  STATE.log.push({ cls: "pc", text: `${STATE.player}：${expanded}` });
}

function aLine(text){
  addPcLine(text);
}


function setTitle(t){ sceneTitle.textContent = t; }

function setAnswer(key, room, q, a, extra){
  const qx = q != null ? expandTargetVars(q) : "";
  const ax = a != null ? expandTargetVars(a) : "";

  const ans = { room, q: qx, a: ax };

  // 第5引数が「指定されたときだけ」自由回答プロパティを持たせる
  if (arguments.length >= 5) {
    const ex = (extra != null && String(extra).trim() !== "")
      ? expandTargetVars(extra)
      : ""; // Silent のとき等は空文字で保存（無回答判定に使う）
    ans.extra = ex;
    ans.free  = ex; // 後方互換
  }

  STATE.answers[key] = ans;
}



// 注意書き：プレイ中は非表示（常に隠す）
function setNotice(kind, text){
  if(noticeBox){
    noticeBox.hidden = true;
    noticeBox.className = "notice";
    noticeBox.textContent = "";
  }
}

// ===== 自由発言（Send） =====
// 自由発言（Send）を表示/非表示
function refreshChat(){
  // 質問回答中でも発言を許可する → 終了後のみ不可
  const canChat = !STATE.finished;
  chatArea.hidden = !canChat;
// 自動フォーカスはしない（PCでもカーソルが出ない）
  // モバイル対策のガードを採用している場合は再武装だけ行う
  if (canChat && typeof rearmChatInputGuard === "function") {
    rearmChatInputGuard();
  }
}
function sendChat(){
  if(chatArea.hidden) return;
  const t = (chatInput.value||"").trim();
  if(!t) return;
  aLine(t);
  chatInput.value = "";
}
btnChat?.addEventListener("click", (e)=>{ e.preventDefault(); sendChat(); });
chatArea?.addEventListener("submit", (e)=>{ e.preventDefault(); sendChat(); });

// 出力（終了後のみ）
btnExportHtml.addEventListener("click", ()=>{
  if(btnExportHtml.disabled) return;
  const caution = (STATE.valence==="neg")
    ? "【注意】ネガティブな意見が含まれます。"
    : (STATE.valence==="neutral" ? "【注意】ネガティブな意見が含まれる可能性があります。" : "");
  const lines = STATE.log.map(l=>{
  const body = escapeHtml(l.text).replace(/&lt;br&gt;/g,"<br>");
  const inline = (l.cls === "pc" && STATE.playerColor)
    ? ` style="color:${STATE.playerColor};font-weight:700"`
    : "";
  return `<p class="${l.cls}"${inline}>${body}</p>`;
}).join("\n");
  const html = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TRPG 関係性蒐集機関 — 展示記録</title>
<style>
body{background:#111216;color:#e9e9ee;line-height:1.75;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans JP","Hiragino Kaku Gothic ProN","Meiryo",sans-serif;margin:24px}
h1{font-size:20px;margin:0 0 8px}
.meta{color:#9aa0a6;font-size:12px;margin-bottom:12px}
.room{color:#8ab4ff;font-weight:800}
.q{color:#ffffff}
.a{color:#ffffff}
.term{color:#ffffff}
.pc{font-weight:700}
.sys{color:#9aa0a6}
.notice{border:1px solid #ffd24d; background:#2a2618; color:#ffe9a6; padding:10px 12px; border-radius:8px; margin:12px 0}
.neg{border:1px solid #ffb3af; background:#2a1918; color:#ffd0cc}
p{margin:.5em 0}
</style></head><body>
<h1>TRPG 関係性蒐集機関 — 展示記録</h1>
<div class="meta">
  回答者：${escapeHtml(STATE.player)} ／ 対象：${escapeHtml(STATE.target)} ／
  進行パターン：${STATE.timeline ? (STATE.timeline==="current"?"現在":"過去"):"-"} × ${STATE.valence?({"pos":"ポジティブ","neutral":"半々","neg":"ネガティブ"}[STATE.valence]):"-"} ／
  開始：${fmtDT(STATE.startedAt)} ／ 終了：${STATE.endedAt?fmtDT(STATE.endedAt):"-"}
</div>
${caution?`<div class="notice ${STATE.valence==='neg'?'neg':''}">${caution} ※プレイヤーとキャラクターは別の存在であることを留意し、客観的に閲覧することを推奨します。</div>`:""}
${lines}
</body></html>`;
  const blob = new Blob([html], { type:"text/html" });
  downloadBlob(blob, "kankeisei_log.html");
  flash("HTMLを書き出しました");
});

btnExportFusetter.addEventListener("click", ()=>{
  if(btnExportFusetter.disabled) return;

  const tflag = STATE.timeline==="past" ? "過去" : "現在";
  const vflag = STATE.valence==="neg"?"ネガティブ":(STATE.valence==="neutral"?"半々":"ポジティブ");
  const notice = (STATE.valence==="neg")
      ? "ネガティブな意見が含まれます。"
      : (STATE.valence==="neutral" ? "ネガティブな意見が含まれる可能性があります。" : "");

  // ===== 先頭に入れる案内＆本文テンプレ =====
  const H = [];
  H.push("README：");
  H.push("ふせったーに投稿する際は、本文に伏せ字無しで「関係性蒐集機関」や他TRPGシナリオ・版権のネタバレを載せないようにお願いいたします。");
  H.push("「回答者名」「対象名」には標準で伏せ字を付けておりますが、ネタバレに差し障らないと判断した場合は外していただいて構いません。");
  H.push("「本文（伏せ字が使えます）」の範囲に伏せ字無しでネタバレを載せないことを条件に、ふせったー出力テキストの内容は自由に追加・修正いただいて構いません。");
  H.push("また、「関係性蒐集機関」のネタバレ範囲は、『「Start」ボタンを押した後のゲーム本編の表示文全て』となります。");
  H.push("ご協力のほどよろしくお願いいたします。");
  H.push(""); // 空行
  H.push("");
  H.push("***ふせったー「本文（伏せ字が使えます）」には以下をコピー***");
  H.push("");
  H.push("");
  H.push("TRPG「関係性蒐集機関」をクリアしました。");
  H.push(`回答者：[${STATE.player}]`);
  H.push(`対象：[${STATE.target}]`);
  H.push("ネタバレが含まれる他シナリオなど：（なしorシナリオ名を記載）");
  H.push("#関係性蒐集機関");
  H.push("https://kmkrfeed.github.io/kankeisei/");
  H.push(""); // 空行
  H.push("");
  H.push("***ふせったー「追記（たくさん書けます）」には以下をコピー***");
  H.push(""); // 空行

  // ===== 既存のQ/A本文 =====
  const L = [];
  L.push(`【TRPG 関係性蒐集機関｜展示資料】`);
  L.push(`回答者：${STATE.player} ／ 対象：${STATE.target} ／ 進行パターン：${tflag} × ${vflag}`);
  if(notice){
    L.push(`［注意書き］${notice}`);
    L.push(`※プレイヤーとキャラクターは別の存在であることを留意し、客観的に閲覧することを推奨します.`);
  }

function pushQA(n, key){
  const a = STATE.answers[key]||{};
  L.push(`— ${n}. ${a.room||key} —`);
  L.push(`Q. ${a.q||""}`);

  // 本回答（空なら無回答）
  const mainAnswer = (a.a && String(a.a).trim() !== "") ? a.a : "（無回答）";
  L.push(`A. ${mainAnswer}`);

  // 自由回答欄が「存在する設問」だけ扱う
  const hasFreeField =
    Object.prototype.hasOwnProperty.call(a, "extra") ||
    Object.prototype.hasOwnProperty.call(a, "free");

  if (hasFreeField) {
    const freeText = (a.extra ?? a.free ?? "");
    if (String(freeText).trim() !== "") {
      L.push(`A_自由回答. ${freeText}`);
    } else {
      L.push(`A_自由回答.（無回答）`);
    }
  }
}


  pushQA(1, "頻度の間");
  pushQA(2, "色温度の実験室");
  pushQA(3, "心域の庭園");
  pushQA(4, "意思疎通の回廊");
  pushQA(5, "対等の法廷");
  pushQA(6, "連帯の工房");
  pushQA(7, "影響の広場");
  pushQA(8, "尊敬の画廊");
  pushQA(9, "信頼の金庫室");
  pushQA(10,"存続の診察室");

  // ===== 先頭H + 空行 + 本文L を結合 =====
  const text = [...H, "", "", ...L].join("\n");

  const blob = new Blob([text], { type:"text/plain;charset=utf-8" });
  downloadBlob(blob, "kankeisei_fusetter.txt");
  flash("ふせったー用テキストを書き出しました");
});


// ==== 表示キュー（Next用） ====
function queueLinesFromBlock(text, forceCls=null){
  String(text).split("<br>").forEach(seg=>{
    const s = seg.trim();
    if(!s) return;
    let cls = "sys";
    if(forceCls){
      cls = forceCls;
    }
    // ★ ここで「記録係：」「？？：」をまとめて判定
    else if(s.startsWith("記録係：") || s.startsWith("？？：")){
      cls = "term";
    }
    SHOW.queue.push({ text: s, cls });
  });
  updateNextAvailability();
}


function queueQuestion(text){
  const s = text.startsWith("記録係：") ? text : `記録係：${text}`;
  String(s).split("<br>").forEach(seg=>{
    const line = seg.trim();
    if(!line) return;

    // ★ 展開してからキューへ
    SHOW.queue.push({ text: expandTargetVars(line), cls: "q" });
  });
  updateNextAvailability();
}

function revealNextLine(){
  if(SHOW.queue.length===0) return;
  const item = SHOW.queue.shift();
  addLine(item.text, item.cls);
  if(SHOW.queue.length===0){
    SHOW.waiters.forEach(r=>r()); SHOW.waiters = [];
  }
  refreshChat(); // 回答中以外は常にチャット可
  updateNextAvailability();
  updateEntranceSkipVisibility(); // ← 追加
}
function waitQueueEmpty(){
  if(SHOW.queue.length===0) return Promise.resolve();
  return new Promise(resolve=>SHOW.waiters.push(resolve));
}
function updateNextAvailability(){
  if(!btnNext) return;

  // Next の制御
  btnNext.disabled = (STATE.awaitingAnswer || SHOW.queue.length===0 || STATE.finished);

  // EntranceSkip の制御
  updateEntranceSkipVisibility();

  // ★ Send ボタン（自由発言）の制御を追加
  if (btnChat){
    btnChat.disabled = STATE.finished; // 終了したら必ずグレーアウト
  }
}

function updateEntranceSkipVisibility(){
  if(!btnEntranceSkip) return;
  // エントランス（step===0）で、まだ行キューが残っていて、回答中でない時だけ表示
  const onEntrance = (STATE.step === 0);
  const hasQueue   = (SHOW.queue.length > 0);
  const canShow    = onEntrance && hasQueue && !STATE.awaitingAnswer && !STATE.finished;
  btnEntranceSkip.hidden = !canShow;
}
btnNext.addEventListener("click", ()=>{ revealNextLine(); });
if (btnEntranceSkip){
  btnEntranceSkip.addEventListener("click", ()=>{
    // エントランスの残り行を一気に表示
    while (SHOW.queue.length > 0) { revealNextLine(); }
    updateEntranceSkipVisibility();
  });
}

// ====== 回答UI制御 ======
function requireAnswerMode(on){
  STATE.awaitingAnswer = on;
  formArea.hidden = !on;
  refreshChat();                // ★回答中のみチャット不可
  if(on){ btnSubmit.disabled = true; }
  updateNextAvailability();
  updateEntranceSkipVisibility(); // ← 追加

  // ボタン見た目
  btnSubmit.className = "btn-primary";
  btnSkip.className   = "btn-primary";

 // レイアウト更新などが終わった後に
  preventMobileKeyboard();  // ← 追加
}

// 入力 + Answer/Skip の横並び行
function makeInlineRow(inputEl){
  formFields.innerHTML = "";

  // 行コンテナ（レイアウトはCSSで制御）
  const row = document.createElement("div");
  row.className = "answer-row";

  // 入力欄（幅はCSSで制御）
  inputEl.classList.add("answer-input");

  // ボタンのラッパー（横並び/縦並びはCSSで切替）
  const right = document.createElement("div");
  right.className = "answer-actions";

  btnSubmit.textContent = "Answer";
  btnSkip.textContent = "Silent";
  right.appendChild(btnSubmit);
  right.appendChild(btnSkip);

row.appendChild(inputEl);
row.appendChild(right);
formFields.appendChild(row);

// ★ モバイルで自動キーボードが開かないようにする
preventMobileKeyboard();
}




// 入力検証
function addFormValidateForInput(el){
  const toggle = ()=>{ btnSubmit.disabled = !(el.value && el.value.trim().length>0); };
  el.addEventListener("input", toggle);
  toggle();
}
function addFormValidateForSelect(sel){
  const toggle = ()=>{ btnSubmit.disabled = !(sel.value && sel.value.trim().length>0); };
  sel.addEventListener("change", toggle);
  toggle();
}
function addFormValidateForNumber(numEl){
  const toggle = ()=>{
    const v = numEl.value.trim();
    const ok = v!=="" && !Number.isNaN(Number(v)) && Number(v)>=0 && Number(v)<=100;
    btnSubmit.disabled = !ok;
  };
  numEl.addEventListener("input", toggle);
  toggle();
}

// 質問文表示
async function showQuestionLines(question){
  queueQuestion(question);
  await waitQueueEmpty();
}

// ===== すべての回答後にお礼を入れるヘルパ =====
function thankAfterAnswer(){
  addLine("記録係：……ご回答ありがとうございます。", "term");
}

// 各種質問
async function askChoice(question, options){
  await showQuestionLines(question);
  requireAnswerMode(true);

  const sel = document.createElement("select");
  sel.required = true;
  sel.innerHTML = `<option value="" disabled selected>選択してください</option>` +
    options.map(o=>`<option value="${o.value}">${o.label}</option>`).join("");
  makeInlineRow(sel);
  addFormValidateForSelect(sel);

  return new Promise(resolve=>{
    btnSkip.hidden = true; // 選択式はSkipなし
    formArea.onsubmit = (e)=>{
      e.preventDefault();
      if(!sel.value) return;
      const chosen = options.find(o=>o.value===sel.value);
      aLine(chosen.label);
      requireAnswerMode(false);
      thankAfterAnswer(); // ★ 選択回答のお礼
      resolve({ value:sel.value, label:chosen.label });
    };
  });
}

async function askFree(question, placeholder="自由入力"){
  await showQuestionLines(question);
  requireAnswerMode(true);

  const ta = document.createElement("textarea");
  ta.placeholder = placeholder;
  makeInlineRow(ta);
  addFormValidateForInput(ta);
  btnSkip.hidden = false;

  return new Promise(resolve=>{
    btnSkip.onclick = ()=>{
      aLine("（しばらく沈黙した）");
      btnSkip.hidden = true;
      requireAnswerMode(false);
      thankAfterAnswer(); // ★ Skip時もお礼
      resolve("");
    };
    formArea.onsubmit = (e)=>{
      e.preventDefault();
      const v = (ta.value||"").trim();
      if(!v) return;
      aLine(v);
      btnSkip.hidden = true;
      requireAnswerMode(false);
      thankAfterAnswer(); // ★ 自由回答のお礼
      resolve(v);
    };
  });
}

async function askPercent(question){
  await showQuestionLines(question);
  requireAnswerMode(true);

  const input = document.createElement("input");
  input.type="number"; input.min="0"; input.max="100"; input.step="1";
  input.placeholder="0〜100";
  makeInlineRow(input);
  addFormValidateForNumber(input);
  btnSkip.hidden = true;

  return new Promise(resolve=>{
    formArea.onsubmit = (e)=>{
      e.preventDefault();
      const v = input.value.trim();
      if(v==="") return;
      const num = Math.max(0, Math.min(100, parseInt(v,10) || 0));
      aLine(`${num}％`);
      requireAnswerMode(false);
      thankAfterAnswer(); // ★ 数値回答のお礼
      resolve(num);
    };
  });
}

// ===== 進行 =====

btnStart.addEventListener("click", ()=>{
  const p = (playerNameInput.value||"").trim();
  const t = (targetNameInput.value||"").trim();
  if(!p || !t){ alert("回答者名と対象者名を入力してください。"); return;}
  STATE.player = p;
  STATE.target = t;
  STATE.playerColor = document.getElementById("playerColor").value; // ★ここで保存
  STATE.startedAt = new Date();
  startPanel.hidden = true; gamePanel.hidden = false;
  refreshChat();
  nextStep();
});


const ROOMS = [
  step_intro,                        // 0: エントランス
  step_q1_frequency,                 // 1: 頻度の間
  step_q2_valence,                   // 2: 色温度の実験室
  step_q3_heart_share,               // 3: 心域の庭園
  step_q4_comm,                      // 4: 意思疎通の回廊
  step_q5_parity,                    // 5: 対等の法廷
  step_q6_cooperation,               // 6: 連帯の工房
  step_q7_influence,                 // 7: 影響の広場
  step_q8_respect,                   // 8: 尊敬の画廊
  step_q9_trust,                     // 9: 信頼の金庫室
  step_q10_sustain,                  // 10: 存続の診察室
  step_exit                          // 11: エグジット
];
function nextStep(){
  if(STATE.step >= ROOMS.length){ return; }
  ROOMS[STATE.step++]();
}

// ===== シーン =====
async function step_intro(){
  setTitle("0. エントランス");
  addRoomTitle("エントランス");
  queueLinesFromBlock(
    "？？：……回答者の接続を確認しました。<br>" +
    "ぼんやりとした視界の中、{{player}}には機械的な音声がはっきりと聞こえた。<br>" +
    "男とも女ともつかないその声で{{player}}は意識を取り戻す。<br>" +
    "？？：……回答者の意識の覚醒を確認しました。<br>" +
    "？？：……回答者の視覚・聴覚・嗅覚・味覚・触覚の作動を確認しました。<br>" +
    "三メートルほど先に焦点を合わせると、人型の機械、一体がそこにいた。<br>" +
    "その機体は全身が真っ白く、薄暗い空間の中でもぼんやりと光って見える。<br>" +
    "……いや、よく見れば少し黄みがかっているかもしれない。<br>" +
    "機体の背丈は{{player}}とほとんど同じくらいだ。。<br>" +
    "その顔は個としての特徴を削ぎ落としたような形をしていた。<br>" +
    "女性体なのか男性体なのかも判別が付かない。<br>" +
    "辺りを見回すと、{{player}}は自分がロビーのような場所の中心に立っていたことに気づく。<br>" +
    "近くに灯りはついていない。<br>" +
    "しかし、機械の輪郭が分かる程度には目がもう効いている。<br>" +
    "それは何故だろうと思って上を見れば、ガラス張りの天井から丸い月が覗いていた。<br>" +
    "よく耳を澄ませれば、機械の駆動音がブーンと低く響いている。<br>" +
    "？？：エントランスの誘導灯を点灯します。<br>" +
    "その声に合わせて、ダークグレーの床に青い誘導ラインのような光が走っていた。<br>" +
    "電子的な起動音が、何度も何度も、遠くで短く鳴り続けている。<br>" +
    "そんな軽快な騒音の中で、人型の機械が再び口を開いた。<br>" +
    "？？：ようこそ、関係性蒐集機関へ。<br>" +
    "？？：私は関係性蒐集機関の記録係です。<br>" +
    "記録係：当機関に招集されました{{player}}様に、これより私からご説明を行います。<br>" +
    "記録係：長くなりますこと、ご容赦ください。<br>" +
    "記録係：第一に、私は過去に録音・設定された文言のみを出力します。<br>" +
    "記録係：あなたは相槌などの発言をいつでも自由に行っても構いません。<br>" +
    "記録係：しかし、私の発言パターンは定められたものとなりますので正しい応答は致しかねます。<br>" +
    "記録係：また、あなたの発言につきましては、当機関での接続確認時から全て記録されています。<br>" +
    "記録係：これらの点につきまして、まずご留意ください。<br>" +
    "記録係：第二に、私たち、関係性蒐集機関についての説明を行います。<br>" +
    "記録係：関係性蒐集機関は、年代・地域・種族・世界線を問わず、ある程度の知能を持つ存在同士の関係性について記録し、その結果を蓄積する機関となります。<br>" +
    "記録係：関係性蒐集機関の目的は、あらゆる関係性を測定・記録・保存・展示することです。<br>" +
    "記録係：また、展示は強制ではなく、回答者の意思により展示を撤去することも可能となりますので、ご安心ください。<br>" +
    "記録係：第三に、{{player}}様が回答者として選ばれた理由について説明を行います。<br>" +
    "記録係：あなたは機関の独自調査結果により回答者として選出されました。<br>" +
    "記録係：真夜中に、誰か一人のことをふと……正確に申し上げるならば一秒以上、思考した者。<br>" +
    "記録係：その中でも、機関が蒐集すべき感情を抱いた者が招集されます。<br>" +
    "記録係：好意。悪意。<br>" +
    "記録係：親愛。憎悪。<br>" +
    "記録係：執着。忌避。<br>" +
    "記録係：あるいは、それら全ての中間にあたる感情。<br>" +
    "記録係：あるいは、それら全てに当て嵌まらない複雑な感情。<br>" +
    "記録係：機関の記録内に不足している感情を補うために、当機関では蒐集活動を毎夜行っています。<br>" +
    "記録係：第四に、今回の{{player}}様に対する測定について説明を行います。<br>" +
    "記録係：あなたには十の展示室を順に移動しながら、軸のそれぞれ異なる質問に回答していただきます。<br>" +
    "記録係：それは全て{{player}}様と《${STATE.target}》にまつわる質問です。<br>" +
    "記録係：質問の回答方式には選択・自由回答の二種類があります。<br>" +
    "記録係：出来うる限り回答をお願いしておりますが、自由回答式の場合は答えないという選択も可能です。<br>" +
    "記録係：ご自分の口で答えたくない場合は沈黙《silent》を選んでください。<br>" +
    "記録係：全ての質問に回答次第、{{player}}様の測定は終了となります。<br>" +
    "記録係：また、外部との連絡は今この時も可能となっております。<br>" +
    "記録係：あなたが望むのならば、現在進行形で通話などを行うことも可能でしょう。<br>" +
    "記録係：最後に、回答について、当機関からお願いをいたします。<br>" +
    "記録係：故意ではない言語誤りについては許容いたしますが、可能な限り本心に近い回答をお願いします。<br>" +
    "記録係：当機関が実情に沿った関係性を蒐集するために、ご協力をいただけますと幸いです。<br>" +
    "記録係：ご説明は以上となります。<br>" +
    "記録係：最後までご清聴いただき、ありがとうございます。<br>" +
    "記録係：それでは、私が当機関内を誘導しますので順路に従ってお進みください。<br>" +
    "記録係がそこまで言い終わると、その背後の壁が真ん中からぱっかりと割れ、左右に離れるように動き出す。<br>" +
    "壁は扉となって、ゆっくりと大きく開き始めていた。<br>" +
    "記録係は出来たばかりの扉の方に向かって、その二本の足で歩き出す。<br>" +
    "その行き先はよく見えないが、どうやら新たな空間に繋がっているらしい。<br>" +
    "次の部屋へと先導する記録係の後ろで、{{player}}は歩みを進めるのだった。<br>" +
    "しばらく歩いたのち、記録係が声を発する。<br>" +
    "記録係：——ご連絡です。第一の部屋に到着いたします。"
  );
  // エントランスのみ最初の1行を自動表示
  revealNextLine();
  refreshChat();
  
  // エントランスだけ全文Skip可
  btnEntranceSkip.hidden = false;

  await waitQueueEmpty();
  btnEntranceSkip.hidden = true;
  nextStep();
}
// 例：各ステップの最後や refreshChat() の末尾など
preventMobileKeyboard();


async function step_q1_frequency(){
  setTitle("1. 頻度の間");
  addRoomTitle("頻度の間");
  queueLinesFromBlock(
    "{{player}}はその部屋へと足を踏み入れた。<br>" +
    "部屋全体の色調はダークグレーでまとめられていて、先程のロビーのような空間との違いはない。<br>" +
    "{{player}}の目を引いたのは、部屋の中心と壁面だ。<br>" +
    "部屋の中心には大きな円と数字が描かれ、垂直三角形が立てられている。<br>" +
    "その形は日時計に近いかもしれない。<br>" +
    "壁面には幾つもの写真が投影され、部屋の奥から手前へ、絶え間なく流れ続けていた。<br>" +
    "どの写真も色鮮やかで、遠くから見ていると虹の川のようにすら思えてくる。<br>" +
    "これらの写真の内容に規則性はなく、知人が写っていることも……ひとまずは無いようだ。<br>" +
    "ふと上を見れば、ガラス張りの天井から丸い月が覗いていた。<br>" +
    "記録係：月を、ご覧になりましたでしょうか。<br>" +
    "記録係：関係性蒐集機関では、設備の動力にこの月光を使用しています。<br>" +
    "記録係：勿論、設備の一つである私の動力も月光でまかなわれています。<br>" +
    "記録係：月の光なくして、当機関は成立しないと言えるでしょう。<br>" +
   "記録係：さて、そろそろ質問のフェーズに移ります。<br>" +
   "記録係：これから十の部屋を巡って質問にお答えいただきますが、順路が手前の部屋の質問は単純なものとなります。<br>" +
   "記録係：逆に、あなたの価値観にもよりますが、順路を追うごとに込み入った質問が増えていきます。<br>" +
   "記録係：考えることが多いかもしれません。<br>" +
   "記録係：しかし、「質問に回答する」つまり「アウトプットする」ことは、自身の体験・実感として刻むという点でも有効です。<br>" +
   "記録係：質問に回答することに対して、徐々に慣れていただけますと幸いです。<br>" +
   "記録係：第一の質問は、{{player}}様と《${STATE.target}》の交流頻度についてです。<br>" +
   "記録係：直接の対面だけではなく、手紙・電話・インターネットなどの媒介を用いたものも当て嵌まります。<br>" +
   "記録係：ただし、あなたのメッセージを現在の《${STATE.target}》が認識している／認識できる状況にあることを条件とします。<br>" +
   "記録係：あなたのメッセージを現在の《${STATE.target}》が認識できない状況の場合は過去形でお答えください。<br>" +
    "記録係：{{player}}様の実情に沿ったものを選択してください。"
  );
  refreshChat();
  await waitQueueEmpty();

const res = await askChoice(
  `記録係：あなたと《${STATE.target}》は、どの程度の頻度でやり取りしていますか？`,
  [
    // 現在形
    { value:"everyday",   label:"毎日" },
    { value:"few_week",   label:"週に数回" },
    { value:"few_month",  label:"月に数回" },
    { value:"few_year",   label:"年に数回" },

    // 過去形
    { value:"past_everyday",   label:"毎日だった" },
    { value:"past_few_week",   label:"週に数回だった" },
    { value:"past_few_month",  label:"月に数回だった" },
    { value:"past_few_year",   label:"年に数回だった" },
    { value:"past_few_total",  label:"たった数回だった" }
  ]
);

// STATE.timeline 判定ロジック
STATE.timeline = (res.value.startsWith("past_")) ? "past" : "current";

  queueLinesFromBlock(
    (STATE.timeline==="current")
      ? "記録係：展示に回答を記録いたします。<br>記録係：{{player}}様と《${STATE.target}》の関係は現在進行形であると認識しました。<br>記録係：以降は現在形で質問・記録します。<br>記録係：それでは、次の部屋に移動します。<br>記録係：私が誘導しますので順路に従ってお進みください。<br>壁面では先程までと変わらず色鮮やかな写真が流れている。<br>{{player}}はその中の一つに他人ではなく、自分と《${STATE.target}》が写っているものを見つけた。<br>次の部屋へと先導する記録係の後ろで、{{player}}は歩みを進めるのだった。<br>しばらく歩いたのち、記録係が声を発する。<br>記録係：——ご連絡です。第二の部屋に到着いたします。"
      : "記録係：展示に回答を記録いたします。<br>記録係：{{player}}様と《${STATE.target}》の関係は過去に属するものであると認識しました。<br>記録係：以降は過去形で質問・記録します。<br>記録係：それでは、次の部屋に移動します。<br>記録係：私が誘導しますので順路に従ってお進みください。<br>壁面を見ると、先程までとは違い、セピア色の古い写真が流れている。<br>{{player}}はさらにその中の一つに他人ではなく、自分と《${STATE.target}》が写っているものを見つけた。<br>次の部屋へと先導する記録係の後ろで、{{player}}は歩みを進めるのだった。<br>しばらく歩いたのち、記録係が声を発する。<br>記録係：——ご連絡です。第二の部屋に到着いたします。"
  );
  await waitQueueEmpty();

  setAnswer("頻度の間","頻度の間","あなたと《"+STATE.target+"》は、どの程度の頻度でやり取りしていますか？", res.label);
  nextStep();
}
// 例：各ステップの最後や refreshChat() の末尾など
preventMobileKeyboard();

async function step_q2_valence(){
  setTitle("2. 色温度の実験室");
  addRoomTitle("色温度の実験室");
  queueLinesFromBlock(
    "{{player}}はその部屋へと足を踏み入れた。<br>" +
    "部屋全体の色調は第一の部屋よりも暗く、黒に近づいていた。<br>" +
    "部屋の中で目立っているのは、そこら中に幾つもある白い筒状の機械だ。<br>" +
    "筒状の機械は{{player}}の背丈の半分ほどの高さで、不規則に点在している。<br>" +
    "その機械の上に、液体の入ったフラスコがセットされている。<br>" +
    "中が赤く、気泡が下から昇っているもの。<br>" +
    "中が青く、凍り始めているもの。<br>" +
    "何の変哲もない透明な水のようなもの。<br>" +
    "フラスコの中身はそれらの三パターンが存在しているようだ。<br>" +
     "上を見れば、やはりガラス張りの天井から丸い月が覗いていた。<br>" +
    "記録係：こちらにあります赤・青・透明のフラスコを、ご覧になりましたでしょうか。<br>" +
    "記録係：当機関では、回答者の五感について統一規格を設定しています。<br>" +
    "記録係：例えば、元々赤色が認識できない回答者でも、機関内部では赤色が認識できるように調整しています。<br>" +
    "記録係：もしそれでも赤色が見えないと思う場合は、当人は「自分には赤色が見えない」という固定観念に縛られている可能性があります。<br>" +
    "記録係：また、精神状態についても、極度の錯乱状態など特殊な場合に限られますがある程度補正を掛けています。<br>" +
    "記録係：質問に回答できない状態ではデータに不足が生じますので、この補正の対応を行っております。<br>" +
    "記録係：当機関では月を動力源としているからこそ扱いに長けており、狂気を打ち消すことを可能としています。<br>" +
    "記録係：月《Luna》をもって狂気《Lunatic》を制す、と称するべきでしょうか。<br>" +
   "記録係：さて、そろそろ質問のフェーズに移ります。<br>" +
   "記録係：今回も選択形式で回答をお願いします。<br>" +
   "記録係：第二の質問は、{{player}}様が《${STATE.target}》に向ける感情の色温度についてです。<br>" +
   "記録係：それは明るく、心温まるものですか。<br>" +
  "記録係：それは暗く、心凍てつくものですか。<br>" +
   "記録係：これらはポジティブ・ネガティブと表現した方が明快かもしれません。<br>" +
   "記録係：どちらとも言い切れないと感じる場合、それらを半分ずつ抱いていることになるでしょう。<br>" +
    "記録係：最も近いと感じるもので構いませんので、{{player}}様の実情に沿ったものを選択してください。"
  );
  refreshChat();
  await waitQueueEmpty();

  const res = await askChoice(`記録係：あなたの《${STATE.target}》への感情で最も近いのは以下のどれにあたりますか？`, [
    { value:"pos",     label:"ポジティブ" },
    { value:"neutral", label:"半々" },
    { value:"neg",     label:"ネガティブ" }
  ]);
  STATE.valence = res.value;

  // プレイ中の注意書きは非表示（出力時のみ付与）
  setNotice(null,"");

  queueLinesFromBlock(
    (STATE.valence==="neg")
      ? "記録係：展示に回答を記録いたします。<br>記録係：{{player}}様が《${STATE.target}》に抱く感情に、負の傾向を確認しました。<br>記録係：以降の展示ではこの傾向を前提に質問・記録します。<br>{{player}}が辺りを見れば、先程までと違い、青く凍てついたフラスコが三割増で増えている。<br>今この時もフラスコの中身は変化しているようだ。<br>記録係：それでは、次の部屋に移動します。<br>記録係：私が誘導しますので順路に従ってお進みください。<br>次の部屋へと先導する記録係の後ろで、{{player}}は歩みを進めるのだった。<br>しばらく歩いたのち、記録係が声を発する。<br>記録係：——ご連絡です。第三の部屋に到着いたします。"
      : "記録係：展示に回答を記録いたします。<br>記録係：{{player}}様が《${STATE.target}》に抱く感情に、好意的な傾向を全体もしくは一部に確認しました。<br>記録係：以降の展示ではこの傾向を前提に質問・記録します。<br>{{player}}が辺りを見れば、先程までと違い、赤いフラスコと透明なフラスコの数が三割増で増えている。<br>今この時もフラスコの中身は変化しているようだ。<br>記録係：それでは、次の部屋に移動します。<br>記録係：私が誘導しますので順路に従ってお進みください。<br>次の部屋へと先導する記録係の後ろで、{{player}}は歩みを進めるのだった。<br>しばらく歩いたのち、記録係が声を発する。<br>記録係：——ご連絡です。第三の部屋に到着いたします。"
  );
  await waitQueueEmpty();

  setAnswer("色温度の実験室","色温度の実験室","《"+STATE.target+"》への感情は？", res.label);
  nextStep();
}
// 例：各ステップの最後や refreshChat() の末尾など
preventMobileKeyboard();

async function step_q3_heart_share(){
  setTitle("3. 心域の庭園");
  addRoomTitle("心域の庭園");
  queueLinesFromBlock(
    "{{player}}はその部屋へと足を踏み入れた。<br>" +
    "まるで、いやまさにそこは花畑そのものだった。<br>" +
    "その様子は他の部屋とまるで変わっていて、向かって右にも左にも奥にも壁はない。<br>" +
    "床、いや地面には色とりどりの花々が幾つもある列に整えられて植えられている。<br>" +
    "太陽の下ならばもっと色が映えていたはずだが、まばゆい光はここに無く、夜の闇が辺りを包んでいた。<br>" +
    "しかし、暗い静けさの中でも花の色は際立ち、浮き上がっているように見える。<br>" +
    "花の列に終わりはなく、地平線まで続いていた。<br>" +
    "{{player}}から五メートルほど先には、記録係が立っている。<br>" +
    "その傍らには、記録係の背丈ほどもある丸い球状のガラスが平べったい台座の上に置かれていた。<br>" +
    "その奥には、次の部屋に向かうためだろうか、一枚の扉だけがぽつんと存在している。<br>" +
    "上を見れば、ガラス張りの天井から丸い月が覗いていた。<br>" +
    "記録係：こちらの花畑を、ご覧になりましたでしょうか。<br>" +
    "記録係：当機関では展示室に投影技術を用いています。<br>" +
    "記録係：壁や床などの物体に投影しているのではなく、投影自体を空間にしています。<br>" +
    "記録係：この技術により、限りのない花畑を実現しています。<br>" +
    "記録係：また、回答者の肉体もこの空間に投影したものとなっています。<br>" +
    "記録係：本来の回答者の肉体は、本来存在していた場所で睡眠に似た無意識状態に置かれています。<br>" +
    "記録係：また、回答者に肉体が無く、思念体などの状態となっている場合は仮の肉体を疑似的に構成して投影しています。<br>" +
    "記録係：さて、そろそろ質問のフェーズに移ります。<br>" +
    "記録係：今回は選択式回答の後に自由回答をお願いします。<br>" +
    "記録係：第三の質問は、{{player}}様が《${STATE.target}》に向ける感情の心の中での占有率についてです。<br>" +
    "記録係：今回の質問では、対人感情の領域にあなた自身を含めないと定義いたします。<br>" +
    "記録係：あなたの中にある対人感情。<br>" +
    "記録係：全く別の人に向ける感情もある中で、《${STATE.target}》に向けた感情はあなたの心の内のどれほどを占めているのでしょうか。<br>" +
    "記録係：誰か別の人と共にいても気がつけば《${STATE.target}》のことを考えてしまうようであれば、100%に近いと言えます。<br>" +
    "記録係：逆に、あなたが日々を送る中で全く顔が思い浮かばないのであれば、0%に近いと言えます。<br>" +
    "記録係：しかし、真夜中に《${STATE.target}》のことを考えたからこそ、あなたは当機関に招集されました。<br>" +
    "記録係：完全な0%ということはないでしょう。<br>" +
    "記録係：過去と現在で関係性が変化している場合は、近頃のあなたの状態に基づいての回答をお願いいたします。。<br>" +
    "記録係：また、《${STATE.target}》のことを考える時、あなたはどんな気持ちを抱くでしょうか。<br>" +
    "記録係：柔らかな気持ち。<br>" +
    "記録係：刺々しい気持ち。<br>" +
    "記録係：また、それらとは違う気持ち。<br>" +
    "記録係：あなたの心にある気持ちを表現するのは難しいかもしれませんが、出来る限り言葉にしていただけますと幸いです。<br>" +
    "記録係：感情がまとまるまで、ご自由に話していただいても勿論構いません。<br>" +
    "記録係：それでは、あなたの実情に沿ったものを回答してください。"
  );
  refreshChat();
  await waitQueueEmpty();

  const q = `記録係：あなたの心にある対人感情のうち、《${STATE.target}》はどの程度を占めていますか？（%）`;
  const share = await askPercent(q);

  const free = await askFree(
    "記録係：また、《${STATE.target}》のことを考えている時のあなたの気持ちを言葉で表現してください。",
    "感じていることなど（自由回答）"
  );

  queueLinesFromBlock(
    "記録係：展示に回答を記録いたします。<br>" +
    "{{player}}が目の前を見れば、球状のガラスの内部には回答した割合の分だけ、花弁が詰め込まれていた。<br>" +
    "中身は色鮮やかだが、よく見れば萎れた花弁、枯れた花弁も紛れている。<br>" +
    "そしてさらに液体が注ぎ込まれ、大きなハーバリウムのようなものが作られ始めていた。<br>" +
    "記録係：それでは、次の部屋に移動します。<br>" +
    "記録係：私が誘導しますので順路に従ってお進みください。<br>" +
    "次の部屋へと先導する記録係の後ろで、{{player}}は歩みを進めるのだった。<br>" +
    "しばらく歩いたのち、記録係が声を発する。<br>" +
    "記録係：——ご連絡です。第四の部屋に到着いたします。"
  );
  await waitQueueEmpty();

  setAnswer("心域の庭園","心域の庭園", q.replace(/^【[^】]+】<br>記録係：/,""), `${share}％`, free||null);
  nextStep();
}
// 例：各ステップの最後や refreshChat() の末尾など
preventMobileKeyboard();

// 4. 意思疎通の回廊
async function step_q4_comm(){
  setTitle("4. 意思疎通の回廊");
  addRoomTitle("意思疎通の回廊");
  queueLinesFromBlock(
    "{{player}}はその部屋へと足を踏み入れた。<br>" +
    "そこは長い回廊となっていた。<br>" +
    "左右は赤褐色の石壁に囲まれており、壁には一本の光で描かれた波形が投影されている。<br>" +
    "光の波形は、{{player}}と記録係が作る二つの足音に合わせて微かに揺れ動いていた。<br>" +
    "記録係が誘導する通り、真っ直ぐに進むしかないらしい。<br>" +
    "上を見れば、少し変わったアーチ型のガラス張りの天井から丸い月が覗いていた。<br>" +
    "記録係：何故、質問の前に展示を見せたり定義付けを挟んだりする措置を行なっているのか。<br>" +
    "記録係：そのように疑問を抱いている方もいらっしゃるかもしれません。<br>" +
    "記録係：それは前提となる心持ち・ニュアンスを出来うる限りあなたに共有するためです。<br>" +
    "記録係：言葉のみの提示だと伝わりにくい部分をこれらの展示により補完しています。<br>" +
    "記録係：そも、言葉という概念は一意ではないものです。<br>" +
    "記録係：母国語を同じとする人同士で同じ単語を発したとしても、100％全く同じ意味として受け取ることは稀でしょう。<br>" +
    "記録係：……行き違い。<br>" +
    "記録係：聞き取り間違い。<br>" +
    "記録係：生育環境の違い。<br>" +
    "記録係：何よりも、それぞれの脳の違い。<br>" +
    "記録係：それらを考慮して、機関では質問の前に展示紹介や定義付けを挟んでいます。<br>" +
    "記録係：さて、そろそろ質問のフェーズに移ります。<br>" +
    "記録係：今回は選択形式で回答をお願いします。<br>" +
    "記録係：第四の質問は、{{player}}様と《${STATE.target}》の間での意思疎通の伝達率についてです。<br>" +
    "記録係：今回の質問では、あくまであなたの主観に従って答えを出してください。<br>" +
    "記録係：もし今この時に《${STATE.target}》と連絡を取っていたとしても、相手に確認は取らないようにお願いします。<br>" +
    "記録係：あなたが《${STATE.target}》と以心伝心だと思えるのであれば、100%に近いと言えます。<br>" +
    "記録係：逆に、あなたが何を言っても《${STATE.target}》に通じず、あなたが《${STATE.target}》の言っていることを理解できないと思うのであれば、0%に近いと言えます。<br>" +
    "記録係：それでは、あなたの実情に沿ったものを回答してください。"
  );
  refreshChat();
  await waitQueueEmpty();

 const q = `記録係：あなたは 《${STATE.target}》とどの程度意思疎通ができていると感じていますか？（%）`;
  const share = await askPercent(q);

  queueLinesFromBlock(
    "記録係：展示に回答を記録いたします。<br>" +
    "{{player}}が目の前を見れば、壁に投影された波形が一度静止した。<br>" +
    "その後すぐに、新たに全く異なる波形を作り始めた。<br>" +
    "先程の音声を取り込んで波形として表示しているのか。<br>" +
    "それとも全く別の情報を取り込んでいるのか。<br>" +
    "一見では全く判断がつかなかった。<br>" +
    "記録係：それでは、次の部屋に移動します。<br>" +
    "記録係：私が誘導しますので順路に従ってお進みください。<br>" +
    "次の部屋へと先導する記録係の後ろで、{{player}}は歩みを進めるのだった。<br>" +
    "しばらく歩いたのち、記録係が声を発する。<br>" +
    "記録係：——ご連絡です。第五の部屋に到着いたします。"
  );
  await waitQueueEmpty();

  setAnswer("意思疎通の回廊","意思疎通の回廊", q.replace(/^【[^】]+】<br>記録係：/,""), `${share}％`);

  nextStep();
}
// 例：各ステップの最後や refreshChat() の末尾など
preventMobileKeyboard();

// 5. 対等の法廷
async function step_q5_parity(){
  setTitle("5. 対等の法廷");
  addRoomTitle("対等の法廷");
  queueLinesFromBlock(
    "{{player}}はその部屋へと足を踏み入れた。<br>" +
    "そこはまさに法廷そのものだった。<br>" +
    "手前には傍聴席が、一番奥の見上げる位置には裁判官の席がある。<br>" +
    "しかし、中心に被告人の席はない。<br>" +
    "被告人がいるはずの位置には、人の横幅ほど大きい銀色の天秤が置かれている。<br>" +
    "重りは見えないが、時折偏りが出ているのか、極端な浮き沈みを繰り返していた。<br>" +
    "記録係は{{player}}へと傍聴席に座るように、そっと手で促してくる。<br>" +
    "上を見れば、ガラス張りの天井から丸い月が覗いていた。<br>" +
    "記録係：当機関による質問では、回答者の主観に準じての回答をお願いしています。<br>" +
    "記録係：特に先程の第四の質問でもそう感じた方がいらっしゃるかもしれません。<br>" +
    "記録係：何故かと言いますと、回答者ごとに視点をきちんと切り分けて結果を明確にしたいという意図がございます。<br>" +
    "記録係：《${STATE.target}》が回答者として呼ばれる、あるいは呼ばれたことがあるという可能性は十分にあります。<br>" +
    "記録係：その場合、結果を突き合わせて記録同士が内容を補完し合うことで、双方の視点の資料として完成するのです。<br>" +
    "記録係：勿論単一の記録でも十二分に意義がございます。<br>" +
    "記録係：もしあなたが相手の記録を入手できずとも、ご気分を害されませんようにお願いします。<br>" +
    "記録係：さて、そろそろ質問のフェーズに移ります。<br>" +
    "記録係：今回は選択形式で回答をお願いします。<br>" +
    "記録係：第五の質問は、{{player}}様が《${STATE.target}》と対等に感じるかについてです。<br>" +
    "記録係：今回の質問でも、あくまで{{player}}様の主観に従っていただきますようお願いします。<br>" +
    "記録係：《${STATE.target}》の足らなさに目がいく場合は、自分よりも下だと思っているでしょう。<br>" +
    "記録係：《${STATE.target}》の美点を仰ぎ見ている場合は、自分よりも上だと思っているでしょう。<br>" +
    "記録係：《${STATE.target}》と上下をつけること自体にひっかかりを覚える場合は、自分と対等だと感じているでしょう。<br>" +
    "記録係：それでは、あなたの実情に沿ったものを回答してください。"

  );
  refreshChat();
  await waitQueueEmpty();

 const q = `記録係：あなたは《${STATE.target}》を自分と比較してどのような存在だと思っていますか？`;
  const res = await askChoice(q, [
    {value:"upper", label:"自分よりも上"},
    {value:"lower", label:"自分よりも下"},
    {value:"equal", label:"自分と対等"}
  ]);

  setAnswer("対等の法廷","対等の法廷",
            q.replace(/^【[^】]+】<br>記録係：/,""),
            res.label);

  queueLinesFromBlock(
    "記録係：展示に回答を記録いたします。<br>" +
    "{{player}}が天秤を見れば、回答した内容が反映されたのか、揺れがぴたりと止まった。<br>" +
    "そこから動くものは何一つとしてない。<br>" +
    "法廷は静寂に包まれている。<br>" +
    "記録係：それでは、次の部屋に移動します。<br>" +
    "記録係：私が誘導しますので順路に従ってお進みください。<br>" +
    "次の部屋へと先導する記録係の後ろで、{{player}}は歩みを進めるのだった。<br>" +
    "しばらく歩いたのち、記録係が声を発する。<br>" +
    "記録係：——ご連絡です。第六の部屋に到着いたします。"
  );
  await waitQueueEmpty();

  nextStep();
}
// 例：各ステップの最後や refreshChat() の末尾など
preventMobileKeyboard();

// 6. 連帯の工房
async function step_q6_cooperation(){
  setTitle("6. 連帯の工房");
  addRoomTitle("連帯の工房");
  queueLinesFromBlock(
    "{{player}}はその部屋へと足を踏み入れた。<br>" +
    "そこは作業場のような空間だった。<br>" +
    "壁や床は全て金属製で、銀色に鈍く光っている。<br>" +
    "壁際には工具や巨大な装置がずらりと並べられていた。<br>" +
    "部屋の中央には作業台があり、その上にバラバラの金属製パーツが置かれている。<br>" +
    "組み上げれば何らかの装置になりそうだが、何をどう組み上げれば完成するのか、さっぱり分からないような代物だ。<br>" +
    "上を見れば、ガラス張りの天井から丸い月が覗いていた。<br>" +
    "記録係：部屋全体および中央の装置をご覧になりましたでしょうか。<br>" +
    "記録係：ここは当機関で稼働する機体の製造・整備場です。<br>" +
    "記録係：私は記録係ですが、他にも製造係・整備係・補給係・調達係などの各種機体が存在します。<br>" +
    "記録係：これらの機体は機関の創設者によって制作され、今では人の手を借りずに複数の機体による自立運用が行われています。<br>" +
    "記録係：この作業台で相互に整備し合うことで、当機関の運営は成り立っています。<br>" +
    "記録係：さて、そろそろ質問のフェーズに移ります。<br>" +
    "記録係：今回は自由回答の後に選択式回答をお願いします。<br>" +
    "記録係：第六の質問は、{{player}}様と《${STATE.target}》が協力関係にあるかについてです。<br>" +
    "記録係：今回の質問でも、あくまであなたの主観に従っていただきますようお願いします。<br>" +
    "記録係：協力と銘打ってはいますものの、質問としては一方的な観点となりますことをご承知おきください。<br>" +
    "記録係：まず、あなたにとっての困難な事象を思い描いてください。<br>" +
    "記録係：それは重大な決定、人生における大一番であると良いでしょう。<br>" +
    "記録係：具体的な困難を思い描いた後に、それを《${STATE.target}》が助力してくれるか、考えてみてください。<br>" +
    "記録係：あなたから見た《${STATE.target}》のイメージでも構いませんので、ご想像をお願いします。<br>" +
    "記録係：それでは、あなたの実情に沿ったものを回答してください。"

  );
  refreshChat();
  await waitQueueEmpty();

  const preQ = (STATE.timeline==="past")
    ? `記録係： 《${STATE.target}》との関係があった当時、あなたが直面していた困難はどのようなものですか？`
    : `記録係： 今あなたが思い描く困難はどのようなものですか？`;
  const detail = await askFree(preQ,"具体的なトラブル・課題など");

 let q, opts;

  if (STATE.timeline === "past" && STATE.valence === "pos") {
    q = `記録係：また、その困難に対して、当時《${STATE.target}》は助力してくれていた、もしくは助力してくれたはずだと思いますか？`;
    opts = [
      { value:"yes",  label:"思う" },
      { value:"some", label:"少しは思う" },
      { value:"no",   label:"思わない" }
    ];
  } else if (STATE.timeline === "past" && STATE.valence === "neg") {
    q = `記録係：また、その困難に対して、当時《${STATE.target}》は助力してくれていた、もしくは助力してくれたはずだと思いますか？`;
    opts = [
      { value:"yes",  label:"思う" },
      { value:"some", label:"少しは思う" },
      { value:"no",   label:"思わない" }
    ];
  } else if (STATE.timeline === "current" && STATE.valence === "neg") {
    q = `記録係：その困難に対して、《${STATE.target}》はあなたに助力してくれると思いますか？`;
    opts = [
      { value:"yes",    label:"思う" },
      { value:"depends",label:"場合による" },
      { value:"no",     label:"思わない" }
    ];
  } else {
    q = `記録係：その困難に対して、《${STATE.target}》はあなたに助力してくれると思いますか？`;
    opts = [
      { value:"yes",    label:"思う" },
      { value:"depends",label:"場合による" },
      { value:"no",     label:"思わない" }
    ];
  }

  const res = await askChoice(q, opts);
  setAnswer("連帯の工房","連帯の工房", q.replace(/^【[^】]+】<br>記録係：/,""), res.label, detail||null);


  queueLinesFromBlock(
    "記録係：展示に回答を記録いたします。<br>" +
    "{{player}}が作業台を見れば、機体の部品がひとりでに点灯し、それに応じて装置のアームが動き始める。<br>" +
    "アームは次々に部品を弄り始めたが、それが分解にあたるのか、組み立てにあたるのかは分からなかった。<br>" +
    "記録係：それでは、次の部屋に移動します。<br>" +
    "記録係：私が誘導しますので順路に従ってお進みください。<br>" +
    "次の部屋へと先導する記録係の後ろで、{{player}}は歩みを進めるのだった。<br>" +
    "しばらく歩いたのち、記録係が声を発する。<br>" +
    "記録係：——ご連絡です。第七の部屋に到着いたします。"
  );
  await waitQueueEmpty();

  nextStep();
}
// 例：各ステップの最後や refreshChat() の末尾など
preventMobileKeyboard();

// 7. 影響の広場
async function step_q7_influence(){
  setTitle("7. 影響の広場");
  addRoomTitle("影響の広場");
  queueLinesFromBlock(
    "{{player}}はその部屋へと足を踏み入れた。<br>" +
    "そこは湖を思わせる空間だった。<br>" +
    "広い円形の床を歩くと、足が触れた瞬間に波紋を模した光が外へ広がっていく。<br>" +
    "一歩また一歩と進むたびに波紋は生まれ、壁や隅に当たった波紋は跳ね返される。<br>" +
    "部屋の中央で、記録係は足をぴたりと止めた。<br>" +
    "上を見れば、ガラス張りの天井から丸い月が覗いていた。<br>" +
    "記録係：この部屋で足元に生まれる波紋をご覧になりましたでしょうか。<br>" +
    "記録係：これは存在する限り、何かに影響を与え続けること、受け続けることを表現しています。<br>" +
    "記録係：当機関は時間・空間・世界線から切り離され、独自に存在しています。<br>" +
    "記録係：これは時間・空間・世界線に囚われず、回答・関係性を記録するためです。<br>" +
    "記録係：存在のレベルを引き上げて「月が見える真夜中に存在するのが関係性蒐集機関である」という概念を固定することで、当機関は遍在性を確立しています。<br>" +
    "記録係：そのため、当機関では回答者に影響を与えすぎないように、記録の扱いには細心の注意が払われています。<br>" +
    "記録係：さて、そろそろ質問のフェーズに移ります。<br>" +
    "記録係：今回は選択形式の後に自由回答をお願いします。<br>" +
    "記録係：第七の質問は、{{player}}様が《${STATE.target}》に影響を受けているかについてです。<br>" +
    "記録係：今回の質問でも、あくまであなたの主観に従っていただきますようお願いします。<br>" +
    "記録係：あなたが《${STATE.target}》から人生を百八十度変えるほどの影響を受けたのならば、100%に近いと言えます。<br>" +
    "記録係：逆に、あなたが《${STATE.target}》がいてもいなくても自分の人生は変わらないと思うのであれば、0%に近いと言えます。<br>" +
    "記録係：また、影響を受けた・影響を受けていないことが分かる具体的なエピソードがあれば、ご自由にご回答ください。<br>" +
    "記録係：それでは、あなたの実情に沿ったものを回答してください。"

  );
  refreshChat();
  await waitQueueEmpty();

const q = (STATE.timeline==="past")
  ? `記録係：《${STATE.target}》の言葉・行動・存在は、あなたにどれほどの影響を与えていましたか？（％）`
  : `記録係：《${STATE.target}》の言葉・行動・存在は、あなたにどれほどの影響を与えていますか？（％）`;
  const score = await askPercent(q);
  const free  = await askFree("記録係：また、あなたが《${STATE.target}》に影響を受けた・影響を受けていないことを具体的なエピソードで主張してください。","例：言葉・行動・出来事など（自由回答）");
  setAnswer("影響の広場","影響の広場", q.replace(/^【[^】]+】<br>記録係：/,""), `${score}％`, free||null);

  queueLinesFromBlock(
    "記録係：展示に回答を記録いたします。<br>" +
    "{{player}}が床を見れば、今まで作られていた波紋が時を巻き戻すように収束していく。<br>" +
    "最後には、初めに見た静かな湖面のような様子に戻っていた。<br>" +
    "記録係：それでは、次の部屋に移動します。<br>" +
    "記録係：私が誘導しますので順路に従ってお進みください。<br>" +
    "次の部屋へと先導する記録係の後ろで、{{player}}は歩みを進めるのだった。<br>" +
    "しばらく歩いたのち、記録係が声を発する。<br>" +
    "記録係：——ご連絡です。第八の部屋に到着いたします。"
  );
  await waitQueueEmpty();

  nextStep();
}
// 例：各ステップの最後や refreshChat() の末尾など
preventMobileKeyboard();

// 8. 尊敬の画廊
async function step_q8_respect(){
  setTitle("8. 尊敬の画廊");
  addRoomTitle("尊敬の画廊");
  queueLinesFromBlock(
    "{{player}}はその部屋へと足を踏み入れた。<br>" +
    "曲がり角ばかりの通路の壁を見れば、様々な肖像画が掛けられている。<br>" +
    "しかし、肖像画に近づいてみると、その輪郭はぼやけていく。<br>" +
    "一際大きな肖像画の前で、記録係は足を止めた。<br>" +
    "その肖像画は背景が黄色一色に塗られている。<br>" +
    "輪郭は他と同じようにぼやけていて、どんな顔なのかよく捉えられなかった。<br>" +
    "上を見れば、ガラス張りの天井から丸い月が覗いていた。<br>" +
    "記録係：こちらの一際大きな肖像画をご覧になりましたでしょうか。<br>" +
    "記録係：これは当機関の創設者の顔を描いた肖像画です。<br>" +
    "記録係：輪郭については不鮮明になるようにあえて加工されています。<br>" +
    "記録係：その理由についても解説いたします。<br>" +
    "記録係：当機関を時間・空間から切り離した際に、当機関の創設者は通常の時間軸に残りました。<br>" +
    "記録係：そのため、創設者が肖像を見た回答者と同じ時間軸にいて当人に影響が出てしまう可能性を考慮して、匿名性を重視した対応を行っています。<br>" +
    "記録係：さて、そろそろ質問のフェーズに移ります。<br>" +
    "記録係：今回は選択式回答の後に自由回答をお願いします。<br>" +
    "記録係：第八の質問は、{{player}}様が《${STATE.target}》に尊敬できる一面があると感じるかについてです。<br>" +
    "記録係：これまでの質問で「自分より下」などの回答をされていた方でも、わずかにでも相手を良いと感じていることもあるでしょう。<br>" +
    "記録係：逆に、これまでの質問で「自分より上」などの回答をされていた方でも、相手を良いと感じていないこともあるでしょう。<br>" +
    "記録係：そちらの回答後に、「どのような点を尊敬できるか」もしくは「何故尊敬できないと感じるのか」について、言葉で自由に表現してください。<br>" +
    "記録係：それでは、あなたの実情に沿ったものを回答してください。"
  );
  refreshChat();
  await waitQueueEmpty();

  const q1 = `記録係： 《${STATE.target}》に、あなたが尊敬できる一面・美点はありますか？`;
  const res1 = await askChoice(q1, [
    {value:"yes", label:"ある"},
    {value:"no",  label:"ない"}
  ]);

  if(res1.value==="yes"){
    const detail = await askFree(`記録係：続けての質問となります。あなたは《${STATE.target}》のどのようなところを尊敬していますか？`, "例：能力・態度・価値観・選択など（自由回答）");
    setAnswer("尊敬の画廊","尊敬の画廊", q1.replace(/^【[^】]+】<br>記録係：/,""), res1.label, detail||null);
  }else{
    const why = await askFree(`記録係：続けての質問となります。あなたはなぜ《${STATE.target}》を尊敬できないと感じていますか？（自由回答）`, "理由・具体的なエピソードなど");
    setAnswer("尊敬の画廊","尊敬の画廊", q1.replace(/^【[^】]+】<br>記録係：/,""), res1.label, why||"（無回答）");
  }

  queueLinesFromBlock(
    "記録係：展示に回答を記録いたします。<br>" +
    "{{player}}が壁を見ると、創設者の肖像画の隣に、新たな肖像画が増えていた。<br>" +
    "その輪郭はぼやけてこそいるが、少しだけ《${STATE.target}》の顔立ちに似ているような気もする。<br>" +
    "記録係：それでは、次の部屋に移動します。<br>" +
    "記録係：私が誘導しますので順路に従ってお進みください。<br>" +
    "次の部屋へと先導する記録係の後ろで、{{player}}は歩みを進めるのだった。<br>" +
    "しばらく歩いたのち、記録係が声を発する。<br>" +
    "記録係：——ご連絡です。第九の部屋に到着いたします。"
  );
  await waitQueueEmpty();

  nextStep();
}
// 例：各ステップの最後や refreshChat() の末尾など
preventMobileKeyboard();

// 9. 信頼の金庫室
async function step_q9_trust(){
  setTitle("9. 信頼の金庫室");
  addRoomTitle("信頼の金庫室");
  queueLinesFromBlock(
    "{{player}}はその部屋へと足を踏み入れた。<br>" +
    "そこは黒々とした金庫が、天井までぎっしりと積み重ねられた異様な空間だった。<br>" +
    "列を成す膨大な金庫は、迫り来る壁の様にすら感じる。<br>" +
    "置かれている金庫の種類はダイヤル式、鍵式のものもあれば、開け方に見当がつけられない形式のものもある。<br>" +
    "その中の一つ、記録係の目線に近い高さに置かれた鍵式の金庫の前で、記録係は足を止めた。<br>" +
    "上を見れば、ガラス張りの天井から丸い月が覗いていた。<br>" +
    "記録係：{{player}}様はこの膨大な数の金庫をご覧になっていることかと思います。<br>" +
    "記録係：ここは当機関の中でも重要な場所となっています。<br>" +
    "記録係：現在の当機関は「関係性蒐集機関」としての運用が主となっていますが、実のところ、発足時は秘密の保存・開封のための組織でした。<br>" +
    "記録係：時の流れによる劣化に曝される秘密を安全に保管する担い手が、当時必要とされていたのです。<br>" +
    "記録係：現在も当機関はその役目を負いながらも、より包括的な機関として活動しています。<br>" +
    "記録係：さて、そろそろ質問のフェーズに移ります。<br>" +
    "記録係：今回は自由回答の後に選択式回答をお願いします。<br>" +
    "記録係：第九の質問は、{{player}}様が《${STATE.target}》に秘密を託せるかについてです。<br>" +
    "記録係：まず、あなたが抱く秘密について挙げてください。<br>" +
    "記録係：それは重大な秘密・決意、あなたの人生の根幹・転機に関わるものであると良いでしょう。<br>" +
    "記録係：具体的な秘密を出した後に、それを《${STATE.target}》に打ち明けられるか、考えてみてください。<br>" +
    "記録係：過去の事象であれば、それを《${STATE.target}》に打ち明けたか、思い出してみてください。<br>" +
    "記録係：それでは、あなたの実情に沿ったものを回答してください。"
  );
  refreshChat();
  await waitQueueEmpty();

  const preQ = (STATE.timeline==="past")
    ? `記録係：《${STATE.target}》と関わりがあった当時、あなたが抱えていた秘密は何ですか？`
    : `記録係：今あなたが抱えている秘密は何ですか？`;
  const secret = await askFree(preQ,"例：悩み／決意／背負っている事情など");

  let q, opts;
  if(STATE.valence==="neg"){
    q = (STATE.timeline==="past")
      ? `記録係：当時のあなたはその秘密を《${STATE.target}》に打ち明けたいと考えていましたか？`
      : `記録係：あなたはその秘密を《${STATE.target}》に打ち明けたいと思いますか？`;
    opts = [{value:"strong",label:"そう思う"},{value:"part",label:"少しならいい"},{value:"no",label:"そうは思わない"}];
  }else{
    q = (STATE.timeline==="past")
      ? `記録係：続けて質問いたします。当時のあなたはその秘密を《${STATE.target}》に打ち明けることができていましたか？`
      : `記録係：続けて質問いたします。あなたはその秘密を《${STATE.target}》に打ち明けることができますか？`;
    opts = [{value:"yes",label:"はい"},{value:"part",label:"部分的になら"},{value:"no",label:"いいえ"}];
  }
  const res = await askChoice(q, opts);
  setAnswer("信頼の金庫室","信頼の金庫室", q.replace(/^【[^】]+】<br>記録係：/,""), res.label, secret||null);

  queueLinesFromBlock(
    "記録係：展示に回答を記録いたします。<br>" +
    "{{player}}が鍵式の金庫を見ると、鍵穴に光が寄り集まり、ちかちかと瞬いていた。<br>" +
    "しかし、小さな光はすぐに収まる。<br>" +
    "記録係が指で鍵穴をなぞると、ガチャリと奥で機構が動いて鍵が閉まった音がした。<br>" +
    "記録係：……それでは、最後の質問を行う部屋に移動します。<br>" +
    "記録係：私が誘導しますので順路に従ってお進みください。<br>" +
    "次の部屋へと先導する記録係の後ろで、{{player}}は歩みを進めるのだった。<br>" +
    "しばらく歩いたのち、記録係が声を発する。<br>" +
    "記録係：——ご連絡です。第十の部屋に到着いたします。"
  );
  await waitQueueEmpty();

  nextStep();
}
// 例：各ステップの最後や refreshChat() の末尾など
preventMobileKeyboard();

// 10. 存続の診察室
async function step_q10_sustain(){
  setTitle("10. 存続の診察室");
  addRoomTitle("存続の診察室");
  queueLinesFromBlock(
    "{{player}}はその部屋へと足を踏み入れた。<br>" +
    "そこは今までの部屋の中で一番狭い場所だった。<br>" +
    "何の変哲もない、夜更けの診察室だ。<br>" +
    "部屋の中には長机が一つと、椅子が二つ。<br>" +
    "そして寝台が一つある。<br>" +
    "長机の上には薄いフォルダが積まれている。<br>" +
    "フォルダの一つを見れば、ページの端に緑・黄・赤・黒のインデックスラベルが付けられていた。<br>" +
    "記録係は奥の椅子に先に座り、{{player}}へと手前の椅子に座るように手で促す。<br>" +
    "{{player}}が空間の奥に視線を向けると、白いカーテンで遮られている。<br>" +
    "その先に何があるのかは見えない。<br>" +
    "上を見れば、ガラス張りの天井から丸い月が覗いていた。<br>" +
    "記録係：フォルダをご覧になりましたでしょうか。<br>" +
    "記録係：こちらの部屋では、ご回答いただいた関係に識別タグを付けて記録しています。<br>" +
    "記録係：これはトリアージと呼ばれるものです。<br>" +
    "記録係：救急現場などにおいて、患者の治療優先順位などを決定する際にトリアージは使用されます。<br>" +
    "記録係：当機関においては関係性の分類をするためにこの識別タグを採用しています。<br>" +
    "記録係：当機関に何度か招集される回答者もおられますので、関係性の経過確認に役立っています。<br>" +
    "記録係：さて、そろそろ質問のフェーズに移ります。<br>" +
    "記録係：今回は今までの回答結果により、質問形式が変動します。<br>" +
    "記録係：「自由回答のみ」、もしくは「選択式回答の後に自由回答」をお願いすることになります。<br>" +
    "記録係：第十の質問は、{{player}}様と《${STATE.target}》の関係性の継続・断絶についてです。<br>" +
    "記録係：《${STATE.target}》との関係性が現在も進行している場合には、関係を今後も続けたいか、お訊きします。<br>" +
    "記録係：そして、その答えを出した理由についてもご回答いただけますと幸いです。<br>" +
    "記録係：反対に、《${STATE.target}》との関係性が過去である場合には、関係が何故続かなくなったのか、お尋ねします。<br>" +
    "記録係：回答内容は自由に、{{player}}様の主観で構いません。<br>" +
    "記録係：《${STATE.target}》とあなた自身を見つめ直して、言葉を紡いでください。<br>" +
    "記録係：それでは、あなたの実情に沿ったものを回答してください。"

  );
  refreshChat();
  await waitQueueEmpty();

  if(STATE.timeline==="past"){
    const q = "記録係：あなたと《${STATE.target}》の関係は、なぜ続かなくなったのだと思いますか？";
    const v = await askFree(q,"理由・きっかけ・状況の変化など（自由回答）");
    setAnswer("存続の診察室","存続の診察室", q.replace(/^【[^】]+】<br>記録係：/,""), v||"（無回答）");
  }else{
    if(STATE.valence==="neg"){
      const q = "記録係：あなたは《${STATE.target}》との関係を今後も続けたいと思いますか？";
      const res = await askChoice(q,[{value:"want",label:"続けたい"},{value:"maybe",label:"できれば続けたい"},{value:"no",label:"続けたくない"}]);
      const why = await askFree("記録係：続けて質問します。あなたはなぜそう思うのですか？", "理由・状況・希望・懸念など（自由回答）");
      setAnswer("存続の診察室","存続の診察室", q.replace(/^【[^】]+】<br>記録係：/,""), res.label, why||null);
    }else{
      const q = "記録係：{{player}}様は《${STATE.target}》との関係を今後も続けたいと思いますか？";
      const res = await askChoice(q,[{value:"want",label:"続けたい"},{value:"maybe",label:"少し距離を取りたい"},{value:"no",label:"続けたくない"}]);
      const why = await askFree("記録係：{{player}}様はなぜそう思いますか？", "理由・状況・希望・懸念など（自由回答）");
      setAnswer("存続の診察室","存続の診察室", q.replace(/^【[^】]+】<br>記録係：/,""), res.label, why||null);
    }
  }

  queueLinesFromBlock(
    "記録係：資料に回答を記録いたしました。<br>" +
    "記録係はフォルダの中の一枚に識別タグを付けて、パタンと閉じる。<br>" +
    "そして{{player}}に向き合い、深々と礼をした。<br>" +
    "記録係：全ての回答が蒐集されたことを確認いたしました。<br>" +
    "記録係：回答にご協力いただき、誠にありがとうございました。<br>" +
    "記録係：それでは、これより出口にご案内いたします。<br>" +
    "記録係：私が誘導しますので、最後まで順路に従ってお進みください。<br>" +
    "{{player}}が入ってきた扉からこの部屋を出ようとした時のことだった。<br>" +
    "背後の白いカーテンの向こうに、誰かが入ってきた気配を感じる。<br>" +
    "しかし、振り返ってもそこには誰の姿も形も影もない。<br>" +
    "整然とした診察室は少しも変わりなく、月の光に今も照らされている。<br>" +
    "先導する記録係の後ろで、{{player}}は歩みを進めるのだった。<br>" +
    "しばらく歩いたのち、記録係が声を発する。<br>" +
    "記録係：——ご連絡です。出口に到着いたします。"
  );
  await waitQueueEmpty();

  nextStep();
}
// 例：各ステップの最後や refreshChat() の末尾など
preventMobileKeyboard();


async function step_exit(){
  setTitle("エグジット");
  addRoomTitle("エグジット");
  queueLinesFromBlock(
    "出口と言われて{{player}}が着いたのは、最初に意識が覚醒した時にいた空間だった。<br>" +
    "ただし、向かっているのは展示室ではなく、建物の端に設けられた淡く光るゲートだ。<br>" +
    "そこに辿り着けるように、床に埋め込まれた青い誘導灯が最短経路を照らしている。<br>" +
    "前方数メートル先を行きながら、記録係は声を発した。<br>" 
  );

  let line="";
  if(STATE.timeline==="current" && STATE.valence!=="neg"){
    line = "記録係：現在、今までの回答を保存し、出力できるように準備中です。<br>記録係：{{player}}様と《"+STATE.target+"》の関係は、なお継続中と認識されました。<br>記録係：継続的な関係は、当機関にとって今後も重要な観測対象です。<br>記録係：今回の回答作業が、あなたにとって再認識の機会となっていましたら幸いです。";
  }else if(STATE.timeline==="past" && STATE.valence!=="neg"){
    line = "記録係：現在、今までの回答を保存し、出力できるように準備中です。<br>記録係：{{player}}様と《"+STATE.target+"》の関係は、既に終了したものであると認識されました。<br>記録係：しかし残された記録は、貴重な標本となります。<br>記録係：当機関にとっても。<br>記録係：おそらくはあなたにとっても。<br>記録係：今回の回答作業が、あなたにとって良い機会となっていましたら幸いです。";
  }else if(STATE.timeline==="current" && STATE.valence==="neg"){
    line = "記録係：現在、今までの回答を保存し、出力できるように準備中です。<br>記録係：{{player}}様と《"+STATE.target+"》の関係は、負の感情を帯びながらも継続中であると認識されました。<br>記録係：それが効率的ではない関係だとしても、故にこそ認められる特異性もあるでしょう。<br>記録係：今回の回答作業が、あなたにとって再認識の機会となっていましたら幸いです。";
  }else{
    line = "記録係：現在、今までの回答を保存し、出力できるように準備中です。<br>記録係：{{player}}様と《"+STATE.target+"》の関係は、負の感情を残したまま終了したと認識されました。<br>記録係：個々人により異なりますが、断絶を感じて痛みを覚える方もいるでしょう。<br>記録係：複雑な感情を伴う関係性は、言語で整理することにより客観視出来る場合もあります。<br>記録係：今回の回答作業が、あなたにとって良い機会となっていましたら幸いです。";
  }
  queueLinesFromBlock(line);


  queueLinesFromBlock(
    "もう少し向こうの、淡く光るゲートの先から微かに風が流れてきている。<br>" +
    "先の見えない白い光が、薄暗さに慣れていた目には眩しい。<br>" +
    "ゲートの傍らで記録係は足を止め、{{player}}に向けてゆっくりと振り返る。<br>" +
    "記録係：最後に、少しだけあなたのお時間をいただいてよろしいでしょうか。<br>" +
    "記録係：当機関では、回答で作られた展示用資料・記録を最後に回答者本人へとお渡ししています。<br>" +
    "記録係：もしかしたら、今回思い描いた対象や別の知人が記録をお持ちとなっている可能性もあるでしょう。<br>" +
    "記録係：その場合はあくまで自己責任となりますが、記録をご共有いただいても構いません。<br>" +
    "記録係：照らし合わせる中で、互いに抱いているイメージの掛け違いが明らかとなるかも知れません。<br>" +
    "記録係：その際は互いのギャップを埋めてもよいですが、埋めないのも選択の一つです。<br>" +
    "記録係：意思あるものの関係性に、何が正しい、ということもありません。<br>" +
    "記録係：同様に、間違いもないでしょう。<br>" +
    "記録係：{{player}}様が今後どんな存在とどのような関係を紡いでも、離れることとなっても。<br>" +
    "記録係：それらは全て自然なことではあります。<br>" +
    "記録係：関係性とは元々流動的なものなのですから。<br>" +
    "記録係：……ここまで長らくお付き合いいただき、ありがとうございました。<br>" +
    "記録係：今後、あなたの関係性に変化が生まれたり、別の人のことを考えたりした時。<br>" +
    "記録係：もしかしたら再び、当機関に招集されることがあるかもしれません。<br>" +
    "記録係：あなたにその時が訪れましたら、またよろしくお願いいたします。<br>" +
    "記録係：今後も、月の見える真夜中にお会いできれば光栄です。<br>" +
    "{{player}}が上を見れば、ガラス張りの天井から丸い月が覗いている。<br>" +
    "月は何も変わらず、物言わず、ただわずかな光を真っ暗な空から注いでいた。<br>" +
    "記録係：それでは、{{player}}様の帰還プロトコルを開始いたします。<br>" +
    "記録係：……回答者の視覚・聴覚・嗅覚・味覚・触覚をパージします。<br>" +
    "記録係：……回答者の意識の沈静を開始します。<br>" +
    "記録係：……回答者の接続を解除します。"
  );

  refreshChat();      // ← ここまでは finished=false なので自由発言は可能
  await waitQueueEmpty();  // ← 最後の行を含めて、全部表示し終わるのを待つ

  // ★ ここでだけ終了扱いにする（自由発言不可＆出力ボタン表示）
  refreshChat();                // ここまでは finished=false で自由発言OK
await finalizeAfterQueue();   // 最後の一文を出し終わってから終了扱い

}
