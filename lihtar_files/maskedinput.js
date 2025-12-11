/*! maskedinput.js — soft phone mask for UA (+380)
 * v2.4 — support '8097...' and '8XXXXXXXXXX', keep leading '+', length caps, safe 0XXXXXXXXX→380..., deferred prettify, customValidity reset
 * Usage #1 (auto-init):
 *   <input type="tel" name="phone" data-phone>
 *   <input type="hidden" name="phone_e164">
 *   <input type="hidden" name="phone_last9">
 *   <script src="/js/maskedinput.js" defer></script>
 *
 * Usage #2 (manual init):
 *   <script>MaskedPhone.init({ selector: '#phone' });</script>
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MaskedPhone = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // -------- helpers --------
  function createHiddenIfMissing(form, name) {
    let el = form ? form.querySelector('input[name="' + name + '"]') : null;
    if (!el && form) {
      el = document.createElement('input');
      el.type = 'hidden';
      el.name = name;
      form.appendChild(el);
    }
    return el || null;
  }

  // -------- core normalize w/ hard caps --------
  // Возвращает:
  //   digits : текущее «цифровое» состояние ("380XXXXXXXXX" / "0XXXXXXXXX" / "8097XXXXXXX" / "#########")
  //   e164   : "+380XXXXXXXXX" или "" (если номер неполный/невалидный)
  //   last9  : последние 9 цифр или ""
  //   valid12: true/false — полный международный формат
  function normalizeUA(raw) {
    let s = String(raw || '').replace(/[^\d+]/g, '');
    // Оставляем ровно один ведущий '+'
    s = s.replace(/^\++/, '+').replace(/\+/g, (m, i) => (i === 0 ? '+' : ''));
    let digits = s.replace(/\D/g, '');

    // ---------- Жёсткие лимиты ДО конверсии ----------
    // Чтобы не «переливалось» при наборе разных стилей
    if (digits.startsWith('380')) {
      if (digits.length > 12) digits = digits.slice(0, 12);
    } else if (digits.startsWith('0')) {
      if (digits.length > 10) digits = digits.slice(0, 10); // 0XXXXXXXXX
    } else if (digits.startsWith('80')) {
      if (digits.length > 11) digits = digits.slice(0, 11); // 8097XXXXXXX
    } else if (digits.startsWith('8')) {
      if (digits.length > 11) digits = digits.slice(0, 11); // 8XXXXXXXXXX (реже встречается)
    } else {
      if (digits.length > 9) digits = digits.slice(0, 9);   // #########
    }

    // ---------- Конверсия в международный ----------
    if (digits.startsWith('380')) {
      // уже ок
    } else if (digits.startsWith('0')) {
      // 0XXXXXXXXX -> 380 + XXXXXXXXX (когда готовы все 10)
      if (digits.length === 10) {
        digits = '380' + digits.slice(1, 10);
      }
    } else if (digits.startsWith('80')) {
      // 8097XXXXXXX (11) -> 38097XXXXXXX (префиксуем '3')
      if (digits.length === 11) {
        digits = '3' + digits; // '38097...'
      }
    } else if (digits.startsWith('8')) {
      // Более редкие старые формы:
      // 8XXXXXXXXXX (10) → 380 + (последние 9)
      // 8XXXXXXXXXXX (11) → 380 + (последние 9)
      if (digits.length === 10) {
        digits = '380' + digits.slice(1); // slice(1) = 9 цифр
      } else if (digits.length === 11) {
        digits = '380' + digits.slice(-9);
      }
    } else if (digits.length === 9) {
      // ######### -> 380#########
      digits = '380' + digits;
    }

    // safety
    if (digits.startsWith('380') && digits.length > 12) digits = digits.slice(0, 12);

    const valid12 = digits.startsWith('380') && digits.length === 12;
    const e164 = valid12 ? ('+' + digits) : '';
    const last9 = digits.length >= 9 ? digits.slice(-9) : '';

    return { digits, e164, last9, valid12 };
  }

  // Красивый вид: +380 AA BBB CC DD
  function formatPrettyUA(digits380) {
    if (!digits380 || !digits380.startsWith('380')) return '';
    const nine = digits380.slice(3);
    const a = nine.slice(0, 2);
    const b = nine.slice(2, 5);
    const c = nine.slice(5, 7);
    const d = nine.slice(7, 9);
    let out = '+380';
    if (a) out += ' ' + a;
    if (b) out += ' ' + b;
    if (c) out += ' ' + c;
    if (d) out += ' ' + d;
    return out;
  }

  function attachToInput(input, opts) {
    if (!input) return;

    input.setAttribute('inputmode', 'tel');
    input.setAttribute('autocomplete', input.getAttribute('autocomplete') || 'tel');
    if (!input.getAttribute('maxlength')) input.setAttribute('maxlength', '17'); // "+380 97 878 80 99"
    if (!input.placeholder) input.placeholder = '+380 97 878 80 99';

    const form = input.form || input.closest('form') || null;
    const hiddenE164  = createHiddenIfMissing(form, opts.e164Name);
    const hiddenLast9 = createHiddenIfMissing(form, opts.last9Name);

    let typingTimer = null;

    // Предиктивное ограничение: блокируем лишние цифры ещё до вставки
    function beforeInputHandler(e) {
      if (!e || !e.target) return;
      const it = e.inputType || '';
      if (it && (it.includes('delete') || it.includes('historyUndo') || it.includes('historyRedo'))) return;

      const selStart = e.target.selectionStart ?? e.target.value.length;
      const selEnd   = e.target.selectionEnd   ?? e.target.value.length;
      const current  = String(e.target.value || '');
      const incoming = e.data ?? '';
      if (it === 'insertFromPaste') return; // паста — отдельной логикой

      const next = current.slice(0, selStart) + incoming + current.slice(selEnd);
      const rawDigits = next.replace(/[^\d]/g, '');

      // Кэп зависит от стиля, которым начал пользователь
      let cap;
      if (rawDigits.startsWith('380')) cap = 12;
      else if (rawDigits.startsWith('0')) cap = 10;
      else if (rawDigits.startsWith('80')) cap = 11;
      else if (rawDigits.startsWith('8')) cap = 11;
      else cap = 9;

      if (rawDigits.length > cap) {
        e.preventDefault();
        return false;
      }
    }

    function onPaste(e) {
      const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
      const rawDigits = text.replace(/[^\d]/g, '');

      let cap;
      if (rawDigits.startsWith('380')) cap = 12;
      else if (rawDigits.startsWith('0')) cap = 10;
      else if (rawDigits.startsWith('80')) cap = 11;
      else if (rawDigits.startsWith('8')) cap = 11;
      else cap = 9;

      if (rawDigits.length > cap) {
        e.preventDefault();
        const trimmed = rawDigits.slice(0, cap);
        const selStart = e.target.selectionStart ?? e.target.value.length;
        const selEnd   = e.target.selectionEnd   ?? e.target.value.length;
        const current = String(e.target.value || '');
        e.target.value = current.slice(0, selStart) + trimmed + current.slice(selEnd);
        onInput(); // запустить пайплайн
      }
    }

    // Универсальная отрисовка текущего значения
    function renderValue(norm, showPlusHint, forcePretty) {
      if (forcePretty && norm.digits.startsWith('380')) {
        return formatPrettyUA(norm.digits); // полный/blur/submit
      }
      if (norm.digits.startsWith('380')) {
        // Пока неполный: показываем "+380…" без пробелов, чтобы '+' не исчезал
        return norm.valid12 ? formatPrettyUA(norm.digits) : ('+' + norm.digits);
      }
      // Остальные случаи — просто очищенный ввод (сохраняем '+' если пользователь его ввёл)
      return showPlusHint
        ? ('+' + String(norm.digits || ''))
        : String(input.value || '').replace(/[^\d+]/g, '');
    }

    function applyMask({ fromBlur = false, forcePretty = false } = {}) {
      const raw = input.value;
      const showPlusHint = typeof raw === 'string' && raw.trim().startsWith('+');
      const norm = normalizeUA(raw);

      if (hiddenE164)  hiddenE164.value  = norm.e164;
      if (hiddenLast9) hiddenLast9.value = norm.last9;

      const prettyNow = renderValue(norm, showPlusHint, (forcePretty || (fromBlur && norm.digits.startsWith('380'))));
      if (input.value !== prettyNow) {
        input.value = prettyNow;
        try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {}
      }
    }

    function onInput() {
      // Снимаем «залипшее» сообщение при любом вводе
      try { input.setCustomValidity(''); } catch (_) {}

      if (typingTimer) clearTimeout(typingTimer);

      const raw = input.value;
      const showPlusHint = typeof raw === 'string' && raw.trim().startsWith('+');
      const norm = normalizeUA(raw);

      const display = renderValue(norm, showPlusHint, false);
      if (input.value !== display) {
        input.value = display;
      }

      if (hiddenE164)  hiddenE164.value  = norm.e164;
      if (hiddenLast9) hiddenLast9.value = norm.last9;

      typingTimer = setTimeout(() => applyMask({ fromBlur: false, forcePretty: false }), 120);
    }

    function onBlur() {
      try { input.setCustomValidity(''); } catch (_) {}
      if (typingTimer) clearTimeout(typingTimer);
      applyMask({ fromBlur: true, forcePretty: true });
    }

    function onFormSubmit(e) {
      if (!opts.requireValidOnSubmit) return;
      if (typingTimer) clearTimeout(typingTimer);
      applyMask({ fromBlur: true, forcePretty: true });

      const norm = normalizeUA(input.value);
      if (!norm.e164) {
        try {
          input.setCustomValidity('Введіть номер у форматі +380XXXXXXXXX, 0XXXXXXXXX або 80XXXXXXXXX');
          input.reportValidity();
        } catch (_) {}
        e && e.preventDefault && e.preventDefault();
        return false;
      } else {
        try { input.setCustomValidity(''); } catch (_) {}
      }
    }

    // Порядок важен
    input.addEventListener('beforeinput', beforeInputHandler);
    input.addEventListener('paste', onPaste);
    input.addEventListener('input', onInput);
    input.addEventListener('blur', onBlur);
    if (form) form.addEventListener('submit', onFormSubmit);

    // стартовая синхронизация
    applyMask({ fromBlur: false, forcePretty: false });
  }

  // -------- public API --------
  var API = {
    init: function (options) {
      var opts = Object.assign({
        selector: '#phone',
        e164Name: 'phone_e164',
        last9Name: 'phone_last9',
        requireValidOnSubmit: true
      }, options || {});
      var nodes = document.querySelectorAll(opts.selector);
      if (!nodes || !nodes.length) return;
      nodes.forEach(function (n) { attachToInput(n, opts); });
    },
    normalizeUA: normalizeUA,
    formatPrettyUA: formatPrettyUA
  };

  document.addEventListener('DOMContentLoaded', function () {
    var autoNodes = document.querySelectorAll('input[data-phone]');
    if (autoNodes.length) API.init({ selector: 'input[data-phone]' });
  });

  return API;
}));
