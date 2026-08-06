/* ============================================================================
   SYNC · el canal entre el reproductor y la vista de presentador
   ----------------------------------------------------------------------------
   Las dos ventanas tienen que mostrar siempre la misma slide, y se puede
   navegar desde cualquiera de las dos.

   POR QUÉ ESTO NO ES UNA LÍNEA DE CÓDIGO
   El deck se abre con doble click, o sea con file://. Chrome trata cada
   archivo local como un origen aislado, así que las vías normales de hablar
   entre ventanas fallan de a una según la versión y la configuración. En vez
   de apostar a una, se usan las cuatro y gana la que ande:

     1. DIRECTO       tocar la otra ventana por su referencia de JS.
                      Es instantáneo. Es el que más suele fallar en file://.
     2. BROADCAST     BroadcastChannel. No existe con origen opaco.
     3. EVENTO        el evento "storage" de localStorage.
     4. SONDEO        leer localStorage cada 150ms. Es el más bruto y el
                      último que queda en pie. Nunca lo sacamos.

   Las cuatro escriben y leen el mismo mensaje, así que llega duplicado. Cada
   mensaje va firmado con el id de quien lo emitió y un número que sube, y el
   receptor descarta lo que ya vio. Sin eso, las ventanas se pelean por quién
   manda y la slide rebota sola.
   ========================================================================== */

window.DeckSync = (function () {
  var SONDEO_MS = 150;

  var canal = null;
  var clave = "paranoia:deck";
  var yo = Math.random().toString(36).slice(2) + Date.now().toString(36);
  var reloj = 0;
  var ultimoVisto = -1;
  var alCambiar = function () {};
  var ventanasHermanas = [];

  /* -- lo que viaja ------------------------------------------------------ */

  function armarMensaje(indice) {
    reloj += 1;
    return { de: yo, n: reloj, indice: indice, ts: Date.now() };
  }

  function esNuevo(mensaje) {
    if (!mensaje || typeof mensaje.indice !== "number") return false;
    if (mensaje.de === yo) return false;
    if (mensaje.ts <= ultimoVisto) return false;
    return true;
  }

  function recibir(mensaje) {
    if (!esNuevo(mensaje)) return;
    ultimoVisto = mensaje.ts;
    alCambiar(mensaje.indice);
  }

  /* -- 1. directo: la otra ventana como objeto --------------------------- */

  function sumarVentana(win) {
    if (!win) return;
    if (ventanasHermanas.indexOf(win) === -1) ventanasHermanas.push(win);
  }

  function porDirecto(mensaje) {
    var vivas = [];
    for (var i = 0; i < ventanasHermanas.length; i++) {
      var win = ventanasHermanas[i];
      try {
        if (win.closed) continue;
        vivas.push(win);
        if (win.DeckSync && typeof win.DeckSync.entregar === "function") {
          win.DeckSync.entregar(mensaje);
        }
      } catch (error) {
        /* Chrome bloqueó el acceso entre archivos locales. Queda el sondeo. */
      }
    }
    ventanasHermanas = vivas;
  }

  /* -- 2. BroadcastChannel ----------------------------------------------- */

  function abrirCanal() {
    try {
      canal = new BroadcastChannel(clave);
      canal.onmessage = function (evento) { recibir(evento.data); };
    } catch (error) {
      canal = null;
    }
  }

  /* -- 3 y 4. localStorage: evento y sondeo ------------------------------ */

  function escribirEnStorage(mensaje) {
    try {
      localStorage.setItem(clave, JSON.stringify(mensaje));
    } catch (error) {
      /* modo incógnito o storage lleno: quedan las otras vías */
    }
  }

  function leerDeStorage() {
    try {
      return JSON.parse(localStorage.getItem(clave) || "null");
    } catch (error) {
      return null;
    }
  }

  function escucharStorage() {
    window.addEventListener("storage", function (evento) {
      if (evento.key !== clave || !evento.newValue) return;
      try {
        recibir(JSON.parse(evento.newValue));
      } catch (error) {
        /* mensaje ilegible: lo levanta el sondeo */
      }
    });
  }

  function sondear() {
    setInterval(function () { recibir(leerDeStorage()); }, SONDEO_MS);
  }

  /* -- API --------------------------------------------------------------- */

  return {
    /* Arranca el canal. `opciones.slug` separa un deck de otro; `opciones.al`
       es la función que corre cuando la otra ventana cambió de slide. */
    iniciar: function (opciones) {
      var config = opciones || {};
      clave = "paranoia:deck:" + (config.slug || "deck");
      alCambiar = typeof config.al === "function" ? config.al : alCambiar;

      abrirCanal();
      escucharStorage();
      sondear();
      sumarVentana(window.opener);

      /* Lo último escrito no se aplica al abrir: la ventana nueva se pone en
         hora sola con `alinear()` cuando el reproductor se lo pide. */
      var previo = leerDeStorage();
      if (previo) ultimoVisto = previo.ts;

      return this;
    },

    /* La otra ventana, para poder hablarle directo. */
    emparejar: function (win) { sumarVentana(win); return this; },

    /* Avisar que estamos en otra slide. */
    publicar: function (indice) {
      var mensaje = armarMensaje(indice);
      ultimoVisto = mensaje.ts;
      porDirecto(mensaje);
      if (canal) { try { canal.postMessage(mensaje); } catch (error) {} }
      escribirEnStorage(mensaje);
    },

    /* En qué slide está el resto del mundo, o null si nadie dijo nada. */
    alinear: function () {
      var mensaje = leerDeStorage();
      return mensaje && typeof mensaje.indice === "number" ? mensaje.indice : null;
    },

    /* Puerta de entrada de la vía directa. La llama la otra ventana. */
    entregar: function (mensaje) { recibir(mensaje); }
  };
})();
