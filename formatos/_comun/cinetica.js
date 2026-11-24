/* Tipografía cinética de los reels: tamaños que calzan, palabras que suben desde
   su máscara, cifras que cuentan y el gancho editorial con resaltador. Depende de gsap. */
(function () {
  var CIFRA = /\d/;

  function lineas(el) {
    var ws = el.querySelectorAll(".w, span");
    if (!ws.length) return 1;
    var tops = [];
    ws.forEach(function (s) {
      if (s.parentElement && s.parentElement.classList.contains("w")) return;
      var t = Math.round(s.offsetTop);
      if (tops.every(function (x) { return Math.abs(x - t) > 10; })) tops.push(t);
    });
    return tops.length;
  }

  // Achica de a `paso` px hasta que entra en `lineas` renglones y ninguna palabra pasa del ancho.
  function ajustar(el, op) {
    var tam = op.max;
    var ancho = op.ancho || el.clientWidth;
    el.style.fontSize = tam + "px";
    function pasa() {
      if (lineas(el) > op.lineas) return true;
      var ws = el.querySelectorAll(".w");
      for (var i = 0; i < ws.length; i++) if (ws[i].offsetWidth > ancho + 2) return true;
      return el.scrollWidth > ancho + 4;
    }
    while (pasa() && tam > op.min) { tam -= op.paso || 4; el.style.fontSize = tam + "px"; }
    return tam;
  }

  // Cada palabra en su máscara (.w > .wi); las que llevan cifras van en el acento.
  function trocear(el, texto, op) {
    op = op || {};
    el.textContent = "";
    var palabras = String(texto).trim().split(/\s+/);
    return palabras.map(function (p, k) {
      if (k) el.appendChild(document.createTextNode(" "));
      var w = document.createElement("span");
      w.className = "w";
      var wi = document.createElement("span");
      wi.className = "wi" + (op.cifras !== false && CIFRA.test(p) ? " num" : "");
      wi.textContent = p;
      w.appendChild(wi);
      el.appendChild(w);
      return wi;
    });
  }

  function subir(tl, wis, t, op) {
    op = op || {};
    tl.fromTo(wis, { opacity: 0, yPercent: op.desde || 34, filter: "blur(10px)" }, { opacity: op.opacidad == null ? 1 : op.opacidad, yPercent: 0, filter: "blur(0px)", duration: op.dur || 0.42, ease: "power3.out", stagger: op.stagger == null ? 0.055 : op.stagger }, t);
  }

  // "+ 50 %" → { pre: "+ ", n: 50, dec: 0, suf: " %" }; sin cifra → null.
  function valor(txt) {
    var m = String(txt).match(/^(\D*?)(\d+(?:[.,]\d+)?)(.*)$/);
    if (!m) return null;
    var dec = m[2].indexOf(",") >= 0 ? m[2].split(",")[1].length : 0;
    return { pre: m[1], n: Number(m[2].replace(",", ".")), dec: dec, suf: m[3] };
  }

  // La cifra cuenta de 0 a su valor (sólo si es un número chico: un 18 de diciembre no cuenta).
  function contar(tl, el, txt, t, dur) {
    var v = valor(txt);
    el.textContent = txt;
    if (!v || v.n > 1000) return false;
    var o = { x: 0 };
    var poner = function () {
      var x = v.dec ? o.x.toFixed(v.dec).replace(".", ",") : String(Math.round(o.x));
      el.textContent = v.pre + x + v.suf;
    };
    tl.fromTo(o, { x: 0 }, { x: v.n, duration: dur || 0.7, ease: "power3.out", onUpdate: poner, onComplete: poner }, t);
    tl.call(poner, null, t + (dur || 0.7) + 0.001);
    return true;
  }

  // El gancho editorial: grande, en bloque, visible desde el cuadro 0, con el resaltador que sigue a la voz.
  function gancho(tl, cont, op) {
    var linea = document.createElement("div");
    linea.className = "gancho";
    cont.appendChild(linea);
    var res = document.createElement("i");
    res.className = "gancho-resalte";
    res.style.background = op.resalte.fondo;
    linea.appendChild(res);
    var spans = op.palabras.map(function (p, k) {
      if (k) linea.appendChild(document.createTextNode(" "));
      var s = document.createElement("span");
      s.textContent = p.texto;
      if (CIFRA.test(p.texto)) s.className = "num";
      linea.appendChild(s);
      return s;
    });
    var tam = op.max;
    linea.style.fontSize = tam + "px";
    function cuenta() {
      var tops = [];
      spans.forEach(function (s) { var t = Math.round(s.offsetTop); if (tops.every(function (x) { return Math.abs(x - t) > 10; })) tops.push(t); });
      var ancho = spans.some(function (s) { return s.offsetWidth > op.ancho; });
      return tops.length > op.lineas || ancho || (op.alto && linea.offsetHeight > op.alto);
    }
    while (cuenta() && tam > op.min) { tam -= 4; linea.style.fontSize = tam + "px"; }
    var previa = null;
    if (op.resaltar !== false) op.palabras.forEach(function (p, k) {
      var s = spans[k];
      var t = Math.max(0, p.inicio - 1 / 30);
      var h = s.offsetHeight;
      var caja = { x: s.offsetLeft - 14, y: s.offsetTop + h * 0.12, width: s.offsetWidth + 28, height: h * 0.8 };
      if (previa === null) tl.fromTo(res, Object.assign({ opacity: 1, scale: 1 }, caja), Object.assign({ opacity: 1, scale: 1 }, caja, { duration: 0.001 }), 0);
      else {
        var salta = Math.abs(spans[previa].offsetTop - s.offsetTop) > 10;
        if (salta) { tl.set(res, caja, t); tl.fromTo(res, { scale: 0.8 }, { scale: 1, duration: 0.2, ease: "back.out(2)" }, t); }
        else tl.to(res, Object.assign({ duration: 0.12, ease: "power3.out" }, caja), t);
        tl.set(spans[previa], { color: op.tinta }, t);
      }
      if (previa === null) tl.fromTo(s, { color: op.resalte.tinta }, { color: op.resalte.tinta, duration: 0.001 }, 0);
      else tl.set(s, { color: op.resalte.tinta }, t + 0.05);
      previa = k;
    });
    return { el: linea, spans: spans, resalte: res, tam: tam };
  }

  // El remate de un chat: si trae una cifra, la cifra es la imagen (enorme, en el acento) y el resto la rodea.
  function remate(tl, cont, texto, t, op) {
    op = op || {};
    var m = String(texto).match(/^(.*?)(\d+(?:[.,]\d+)?(?:\s?%)?)(.*)$/);
    cont.innerHTML = "";
    var piezas = [];
    function parte(cls, txt, max, min, lineas) {
      if (!txt) return null;
      var d = document.createElement("div");
      d.className = cls;
      cont.appendChild(d);
      var wis = trocear(d, txt, { cifras: false });
      ajustar(d, { max: max, min: min, lineas: lineas, ancho: op.ancho || 900 });
      piezas.push(d);
      return wis;
    }
    if (m && m[1].trim().split(/\s+/).length <= 7) {
      var pre = parte("remate-txt", m[1].trim(), 100, 64, 2);
      var nd = document.createElement("div");
      nd.className = "remate-num";
      nd.textContent = m[2].trim();
      cont.appendChild(nd);
      var tam = op.num || 560;
      nd.style.fontSize = tam + "px";
      while (nd.scrollWidth > (op.ancho || 900) && tam > 200) { tam -= 20; nd.style.fontSize = tam + "px"; }
      var post = parte("remate-txt", m[3].trim().replace(/^[,.:;]\s*/, ""), 100, 64, 2);
      if (pre) subir(tl, pre, t, { stagger: 0.05 });
      tl.fromTo(nd, { opacity: 0, scale: 1.7, filter: "blur(16px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.55, ease: "power4.out" }, t + 0.42);
      if (post) subir(tl, post, t + 0.62, { stagger: 0.05 });
      return { golpe: t + 0.42, alto: cont.offsetHeight };
    }
    var wis = parte("remate-txt grande", texto, 132, 72, 4);
    var ult = wis[wis.length - 1];
    ult.classList.add("num");
    subir(tl, wis, t, { stagger: 0.06 });
    return { golpe: t + 0.06 * wis.length, alto: cont.offsetHeight };
  }

  var ESTILO = document.createElement("style");
  ESTILO.textContent = [
    ".gancho { position: relative; font-family: var(--f-titulo); font-weight: var(--p-titulo); line-height: 0.98; letter-spacing: calc(var(--tracking-titulo) * 1.5); word-spacing: 0.04em; color: var(--tinta); text-wrap: balance; }",
    ".gancho span { position: relative; z-index: 1; display: inline-block; }",
    ".remate-txt { font-family: var(--f-titulo); font-weight: var(--p-titulo); line-height: 1; letter-spacing: calc(var(--tracking-titulo) * 1.33); color: var(--tinta); text-align: center; text-wrap: balance; }",
    ".remate-num { font-family: var(--f-titulo); font-weight: var(--p-titulo); line-height: 0.82; letter-spacing: calc(var(--tracking-titulo) * 2); color: var(--acento); text-align: center; white-space: nowrap; margin: 18px 0 30px; font-variant-numeric: tabular-nums; }",
    ".gancho-resalte { position: absolute; left: 0; top: 0; width: 10px; height: 10px; border-radius: 18px; opacity: 0; z-index: 0; }",
  ].join("\n");
  document.head.appendChild(ESTILO);

  window.Cinetica = { ajustar: ajustar, trocear: trocear, subir: subir, valor: valor, contar: contar, gancho: gancho, lineas: lineas, remate: remate };
})();
