(() => {
  'use strict';

  /* ---------- Dates (always the user's local calendar) ---------- */

  const pad = (n) => String(n).padStart(2, '0');
  const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (s, n) => {
    const d = parseISO(s);
    d.setDate(d.getDate() + n);
    return isoLocal(d);
  };
  const fmt = (iso, opts) => parseISO(iso).toLocaleDateString(undefined, opts);

  /* ---------- Tiny DOM helper (text is always set as text, never as HTML) ---------- */

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const CHECK_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  function checkIcon() {
    const t = document.createElement('template');
    t.innerHTML = CHECK_SVG; // constant markup only, no user data
    const wrap = h('span', { 'aria-hidden': 'true' });
    wrap.append(t.content.firstChild);
    return wrap;
  }

  /* ---------- State and API ---------- */

  const TOKEN_KEY = 'habit-tracker-token';
  const store = {
    get() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(TOKEN_KEY, v); } catch { /* memory only */ } },
    clear() { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
  };

  const state = { token: store.get(), user: null, today: isoLocal(new Date()), habits: [], detailId: null, detailEntries: [] };

  const $app = document.getElementById('app');
  const $dialog = document.getElementById('dialog');
  const $toasts = document.getElementById('toasts');

  async function api(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error('Can’t reach the server. Check your connection and try again.');
    }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) {
      const isAuthForm = path.startsWith('/api/auth/login') || path.startsWith('/api/auth/register');
      if (res.status === 401 && state.token && !isAuthForm) {
        signOut('Your session ended. Log in again.');
      }
      const details = data && data.error && data.error.details;
      const message =
        details && details.length
          ? details.map((d) => d.message).join(' ')
          : (data && data.error && data.error.message) || 'Something went wrong. Try again.';
      throw new Error(message);
    }
    return data;
  }

  function toast(message, kind) {
    const el = h('div', { class: kind === 'error' ? 'toast toast--error' : 'toast', text: message });
    $toasts.append(el);
    setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3000);
  }

  /* ---------- Chain (14-day strip) ---------- */

  function cellState(date, done, createdDate, today) {
    if (done) return 'done';
    if (date === today) return 'pending';
    if (date < createdDate) return 'before';
    return 'missed';
  }

  // A day only counts as missed after the habit began: its creation day, or the earliest day logged if that is sooner.
  function startOf(createdDate, doneDates) {
    return doneDates.reduce((min, d) => (d < min ? d : min), createdDate);
  }

  function chainCells(days, createdDate, today, extraClass) {
    const start = startOf(createdDate, days.filter((d) => d.completed).map((d) => d.date));
    const states = days.map((d) => cellState(d.date, d.completed, start, today));
    return states.map((s, i) => {
      const joinPrev = s === 'done' && states[i - 1] === 'done';
      const joinNext = s === 'done' && states[i + 1] === 'done';
      return h('span', {
        class: ['cell', `cell--${s}`, joinPrev && 'cell--join-prev', joinNext && 'cell--join-next', extraClass]
          .filter(Boolean)
          .join(' '),
      });
    });
  }

  /* ---------- Sign in / create account ---------- */

  function renderAuth(mode = 'login', notice) {
    state.user = null;
    const isLogin = mode === 'login';
    const error = h('p', { class: 'form__error', role: 'alert' });
    if (notice) error.textContent = notice;

    const email = h('input', { class: 'input', id: 'email', name: 'email', type: 'email', required: true, autocomplete: 'email', maxlength: '254' });
    const password = h('input', {
      class: 'input', id: 'password', name: 'password', type: 'password', required: true, minlength: '8', maxlength: '72',
      autocomplete: isLogin ? 'current-password' : 'new-password',
    });
    const submit = h('button', { class: 'btn', type: 'submit', text: isLogin ? 'Log in' : 'Create account' });

    const form = h(
      'form',
      {
        class: 'form',
        novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = '';
          submit.disabled = true;
          try {
            const data = await api(`/api/auth/${isLogin ? 'login' : 'register'}`, {
              method: 'POST',
              body: { email: email.value, password: password.value },
            });
            state.token = data.token;
            state.user = data.user;
            store.set(data.token);
            await loadDashboard();
          } catch (err) {
            error.textContent = err.message;
            submit.disabled = false;
          }
        },
      },
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'email', text: 'Email' }), email),
      h(
        'div',
        { class: 'field' },
        h('label', { class: 'field__label', for: 'password', text: 'Password' }),
        password,
        isLogin ? null : h('span', { class: 'field__hint', text: 'At least 8 characters.' })
      ),
      error,
      submit
    );

    const tab = (id, label) =>
      h('button', {
        class: 'tab', type: 'button', 'aria-pressed': String(mode === id),
        onclick: () => mode !== id && renderAuth(id),
        text: label,
      });

    // Decorative chains: one unbroken run, one with a break.
    const sample = (pattern) =>
      h('div', { class: 'chain', 'aria-hidden': 'true' },
        chainCells(
          [...pattern].map((c, i) => ({ date: `d${i}`, completed: c === '1' })),
          'a', 'z'
        )
      );

    $app.replaceChildren(
      h(
        'main',
        { class: 'auth' },
        h(
          'section',
          { class: 'auth__intro' },
          h('div', { class: 'auth__chains' }, sample('11111111110111'), sample('01111011111111')),
          h(
            'div',
            {},
            h('h1', { class: 'auth__headline', text: 'Keep the chain going.' }),
            h('p', { class: 'auth__lead', text: 'Check in each day. Your streak shows what you’ve kept up, and where it broke.' })
          )
        ),
        h(
          'section',
          { class: 'auth__panel' },
          h(
            'div',
            { class: 'auth__card' },
            h('div', { class: 'tabs', role: 'group', 'aria-label': 'Account' }, tab('login', 'Log in'), tab('register', 'Create account')),
            form
          )
        )
      )
    );
    email.focus();
  }

  function signOut(notice) {
    state.token = null;
    state.user = null;
    state.habits = [];
    store.clear();
    if ($dialog.open) $dialog.close();
    renderAuth('login', typeof notice === 'string' ? notice : undefined);
  }

  /* ---------- Dashboard ---------- */

  async function loadDashboard(focusId) {
    state.today = isoLocal(new Date());
    const data = await api(`/api/habits/summary?today=${state.today}`);
    state.habits = data.habits;
    renderDashboard(focusId);
  }

  function renderDashboard(focusId) {
    const done = state.habits.filter((x) => x.completed_today).length;
    const total = state.habits.length;

    const sub =
      total === 0
        ? 'Nothing to check in yet.'
        : done === total
          ? h('span', {}, h('strong', { text: 'All done' }), ` for today. ${total} of ${total} checked in.`)
          : h('span', {}, h('strong', { text: `${done} of ${total}` }), ' checked in today.');

    const list =
      total === 0
        ? h(
            'div',
            { class: 'empty' },
            h('h2', { class: 'empty__title', text: 'No habits yet' }),
            h('p', { class: 'empty__text', text: 'Add something you want to do every day. Each check-in adds a link to its chain.' }),
            h('button', { class: 'btn', type: 'button', onclick: openNewHabit, text: 'Add your first habit' })
          )
        : h('ul', { class: 'habits', 'aria-label': 'Your habits' }, state.habits.map(habitRow));

    $app.replaceChildren(
      h(
        'header',
        { class: 'topbar' },
        h(
          'div',
          { class: 'brand' },
          h('span', { class: 'brand__mark', 'aria-hidden': 'true' },
            h('span', { class: 'cell cell--done cell--join-next' }),
            h('span', { class: 'cell cell--done cell--join-prev' }),
            h('span', { class: 'cell cell--missed' })),
          'Habit Tracker'
        ),
        h(
          'div',
          { class: 'topbar__user' },
          h('span', { class: 'topbar__email', text: state.user ? state.user.email : '' }),
          h('button', { class: 'btn btn--quiet btn--small', type: 'button', onclick: () => signOut(), text: 'Log out' })
        )
      ),
      h(
        'main',
        { class: 'page' },
        h(
          'div',
          { class: 'page__head' },
          h(
            'div',
            {},
            h('h1', { class: 'page__title', text: 'Today' }),
            h('p', { class: 'page__sub' }, fmt(state.today, { weekday: 'long', month: 'long', day: 'numeric' }), ' – ', sub)
          ),
          total > 0 ? h('button', { class: 'btn', type: 'button', onclick: openNewHabit, text: 'New habit' }) : null
        ),
        list
      )
    );

    if (focusId) {
      const target = $app.querySelector(`.check[data-id="${focusId}"]`);
      if (target) target.focus();
    }
  }

  function habitRow(habit) {
    const createdDate = isoLocal(new Date(habit.created_at));
    const cur = habit.current_streak;
    const broken = cur === 0 && habit.total_completed > 0;
    const doneCount = habit.recent.filter((d) => d.completed).length;

    const check = h(
      'button',
      {
        class: 'check', type: 'button', dataset: { id: habit.id },
        'aria-pressed': String(habit.completed_today),
        'aria-label': `${habit.name}: done today`,
        onclick: () => toggleDay(habit, state.today, true),
      },
      checkIcon()
    );

    return h(
      'li',
      { class: 'habit' },
      check,
      h(
        'button',
        { class: 'habit__info', type: 'button', dataset: { id: habit.id }, onclick: () => openDetail(habit.id) },
        h('span', { class: 'habit__name', text: habit.name }),
        habit.description ? h('span', { class: 'habit__desc', text: habit.description }) : null
      ),
      h(
        'div',
        { class: 'chain', role: 'img', 'aria-label': `Last 14 days: ${doneCount} of 14 days done` },
        chainCells(habit.recent, createdDate, state.today)
      ),
      h(
        'div',
        { class: broken ? 'streak streak--broken' : 'streak' },
        h('span', { class: 'streak__num', text: String(cur) }),
        h('span', { class: 'streak__unit', text: broken ? 'streak broken' : 'day streak' })
      )
    );
  }

  /* Check in, or undo, a single day. */
  async function toggleDay(habit, date, fromDashboard) {
    const wasDone = fromDashboard
      ? habit.completed_today
      : state.detailEntries.some((e) => e.entry_date === date && e.completed);
    try {
      if (wasDone) await api(`/api/habits/${habit.id}/entries/${date}`, { method: 'DELETE' });
      else await api(`/api/habits/${habit.id}/entries`, { method: 'POST', body: { entry_date: date } });
      if (fromDashboard) {
        await loadDashboard(habit.id);
      } else {
        await refreshDetail();
      }
      toast(wasDone ? 'Check-in removed' : 'Checked in');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /* ---------- Dialogs ---------- */

  $dialog.addEventListener('click', (e) => {
    if (e.target === $dialog) $dialog.close();
  });
  $dialog.addEventListener('close', () => {
    const id = state.detailId;
    state.detailId = null;
    if (id) {
      const back = $app.querySelector(`.habit__info[data-id="${id}"]`);
      if (back) back.focus();
    }
  });

  function showSheet(...children) {
    $dialog.replaceChildren(h('div', { class: 'sheet' }, children));
    if (!$dialog.open) $dialog.showModal();
  }

  const closeButton = () => h('button', { class: 'btn btn--quiet btn--small', type: 'button', onclick: () => $dialog.close(), text: 'Close' });

  function openNewHabit() {
    state.detailId = null;
    const error = h('p', { class: 'form__error', role: 'alert' });
    const name = h('input', { class: 'input', id: 'new-name', required: true, maxlength: '100', placeholder: 'Read for 20 minutes' });
    const desc = h('textarea', { class: 'input', id: 'new-desc', maxlength: '500' });
    const save = h('button', { class: 'btn', type: 'submit', text: 'Add habit' });

    showSheet(
      h('div', { class: 'sheet__head' }, h('h2', { class: 'sheet__title', id: 'dialog-title', text: 'New habit' }), closeButton()),
      h(
        'form',
        {
          class: 'form', novalidate: true,
          onsubmit: async (e) => {
            e.preventDefault();
            error.textContent = '';
            save.disabled = true;
            try {
              await api('/api/habits', { method: 'POST', body: { name: name.value, description: desc.value } });
              $dialog.close();
              await loadDashboard();
              toast('Habit added');
            } catch (err) {
              error.textContent = err.message;
              save.disabled = false;
            }
          },
        },
        h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'new-name', text: 'Name' }), name),
        h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'new-desc', text: 'Notes (optional)' }), desc),
        error,
        h('div', { class: 'form__actions' }, save)
      )
    );
    name.focus();
  }

  async function openDetail(id) {
    state.detailId = id;
    try {
      await refreshDetail();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function calendarRange() {
    const raw = addDays(state.today, -35);
    const start = addDays(raw, -parseISO(raw).getDay());
    const end = addDays(state.today, 6 - parseISO(state.today).getDay());
    const days = [];
    for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
    return { start, days };
  }

  /* Reload the habit list and this habit's entries, then redraw the open sheet. */
  async function refreshDetail() {
    const id = state.detailId;
    const scroll = $dialog.scrollTop;
    const { start } = calendarRange();
    const [, entries] = await Promise.all([
      loadDashboard(),
      api(`/api/habits/${id}/entries?from=${start}&to=${state.today}`),
    ]);
    const habit = state.habits.find((x) => x.id === id);
    if (!habit) { if ($dialog.open) $dialog.close(); return; }
    state.detailEntries = entries.entries;
    renderDetail(habit);
    $dialog.scrollTop = scroll;
  }

  function renderDetail(habit) {
    const entries = state.detailEntries;
    const byDate = new Map(entries.map((e) => [e.entry_date, e]));
    const createdDate = startOf(isoLocal(new Date(habit.created_at)), entries.filter((e) => e.completed).map((e) => e.entry_date));
    const broken = habit.current_streak === 0 && habit.total_completed > 0;

    /* Stats */
    const stat = (num, label, isBroken) =>
      h('div', { class: isBroken ? 'stat stat--broken' : 'stat' }, h('span', { class: 'stat__num', text: String(num) }), h('span', { class: 'stat__label', text: label }));

    /* Calendar: tap a past day to add or remove its check-in. */
    const { days } = calendarRange();
    const dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((c) =>
      h('span', { class: 'cal__dow', 'aria-hidden': 'true', text: c })
    );
    const cells = days.map((date, i) => {
      const future = date > state.today;
      const done = !future && byDate.has(date) && byDate.get(date).completed;
      const s = future ? 'future' : cellState(date, done, createdDate, state.today);
      const showMonth = i === 0 || parseISO(date).getDate() === 1;
      const dayNum = String(parseISO(date).getDate());
      const label = `${fmt(date, { weekday: 'long', month: 'long', day: 'numeric' })}: ${future ? 'upcoming' : done ? 'done. Select to remove.' : 'not done. Select to check in.'}`;
      return h(
        'button',
        { class: `cell cell--${s}`, type: 'button', disabled: future, 'aria-label': label, onclick: () => toggleDay(habit, date, false) },
        h('span', {}, showMonth ? h('span', { class: 'cal__month', text: fmt(date, { month: 'short' }) }) : null, dayNum)
      );
    });

    /* Log a day with a note */
    const logError = h('p', { class: 'form__error', role: 'alert' });
    const logDate = h('input', { class: 'input', id: 'log-date', type: 'date', value: state.today, max: state.today, required: true });
    const logNote = h('input', { class: 'input', id: 'log-note', maxlength: '500', placeholder: 'Optional' });
    const logBtn = h('button', { class: 'btn', type: 'submit', text: 'Save check-in' });
    const logForm = h(
      'form',
      {
        class: 'form', novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          logError.textContent = '';
          logBtn.disabled = true;
          try {
            await api(`/api/habits/${habit.id}/entries`, { method: 'POST', body: { entry_date: logDate.value, completed: true, note: logNote.value } });
            await refreshDetail();
            toast('Check-in saved');
          } catch (err) {
            logError.textContent = err.message;
            logBtn.disabled = false;
          }
        },
      },
      h(
        'div',
        { class: 'log-row' },
        h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'log-date', text: 'Day' }), logDate),
        h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'log-note', text: 'Note' }), logNote),
        logBtn
      ),
      logError
    );

    /* History */
    const done = entries.filter((e) => e.completed).sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1));
    const history =
      done.length === 0
        ? h('p', { class: 'sheet__note', text: 'No check-ins in the last six weeks.' })
        : h(
            'ul',
            { class: 'history' },
            done.map((e) =>
              h(
                'li',
                { class: 'history__item' },
                h('span', { class: 'history__date', text: fmt(e.entry_date, { weekday: 'short', month: 'short', day: 'numeric' }) }),
                e.note ? h('span', { class: 'history__note', text: e.note }) : null,
                h('button', {
                  class: 'btn btn--quiet btn--small', type: 'button', text: 'Remove',
                  'aria-label': `Remove check-in for ${fmt(e.entry_date, { month: 'long', day: 'numeric' })}`,
                  onclick: () => toggleDay(habit, e.entry_date, false),
                })
              )
            )
          );

    /* Edit */
    const editError = h('p', { class: 'form__error', role: 'alert' });
    const name = h('input', { class: 'input', id: 'edit-name', required: true, maxlength: '100', value: habit.name });
    const desc = h('textarea', { class: 'input', id: 'edit-desc', maxlength: '500' });
    desc.value = habit.description || '';
    const editBtn = h('button', { class: 'btn', type: 'submit', text: 'Save changes' });
    const editForm = h(
      'form',
      {
        class: 'form', novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          editError.textContent = '';
          editBtn.disabled = true;
          try {
            await api(`/api/habits/${habit.id}`, { method: 'PUT', body: { name: name.value, description: desc.value } });
            await refreshDetail();
            toast('Changes saved');
          } catch (err) {
            editError.textContent = err.message;
            editBtn.disabled = false;
          }
        },
      },
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'edit-name', text: 'Name' }), name),
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'edit-desc', text: 'Notes' }), desc),
      editError,
      h('div', { class: 'form__actions' }, editBtn)
    );

    /* Delete (two steps, so it can't happen by accident) */
    const dangerBox = h('div', { class: 'danger' });
    const showDelete = () => {
      const del = h('button', { class: 'btn btn--danger', type: 'button', text: 'Delete habit', onclick: arm });
      dangerBox.replaceChildren(del);
    };
    const arm = () => {
      const confirmBtn = h('button', {
        class: 'btn btn--danger-armed', type: 'button',
        text: `Delete for good, with ${habit.total_completed} ${habit.total_completed === 1 ? 'check-in' : 'check-ins'}`,
        onclick: async () => {
          confirmBtn.disabled = true;
          try {
            await api(`/api/habits/${habit.id}`, { method: 'DELETE' });
            state.detailId = null;
            $dialog.close();
            await loadDashboard();
            toast('Habit deleted');
          } catch (err) {
            toast(err.message, 'error');
            confirmBtn.disabled = false;
          }
        },
      });
      dangerBox.replaceChildren(
        h('p', { class: 'sheet__note', text: 'This removes the habit and its whole history. It can’t be undone.' }),
        h('div', { class: 'form__actions' }, confirmBtn, h('button', { class: 'btn btn--quiet', type: 'button', text: 'Keep it', onclick: showDelete }))
      );
      confirmBtn.focus();
    };
    showDelete();

    const legend = h(
      'div',
      { class: 'legend', 'aria-hidden': 'true' },
      h('span', { class: 'legend__item' }, h('span', { class: 'cell cell--done' }), 'Done'),
      h('span', { class: 'legend__item' }, h('span', { class: 'cell cell--missed' }), 'Missed'),
      h('span', { class: 'legend__item' }, h('span', { class: 'cell cell--pending' }), 'Today')
    );

    showSheet(
      h(
        'div',
        { class: 'sheet__head' },
        h('div', {}, h('h2', { class: 'sheet__title', id: 'dialog-title', text: habit.name }), habit.description ? h('p', { class: 'sheet__desc', text: habit.description }) : null),
        closeButton()
      ),
      h(
        'div',
        { class: 'stats' },
        stat(habit.current_streak, 'day streak', broken),
        stat(habit.longest_streak, 'Best streak'),
        stat(habit.total_completed, 'Total days')
      ),
      h(
        'section',
        { class: 'sheet__section' },
        h('h3', { class: 'sheet__h', text: 'Last six weeks' }),
        h('div', { class: 'cal' }, dow, cells),
        legend,
        h('p', { class: 'sheet__note', text: 'Select a day to add or remove its check-in.' })
      ),
      h('section', { class: 'sheet__section' }, h('h3', { class: 'sheet__h', text: 'Add a check-in with a note' }), logForm),
      h('section', { class: 'sheet__section' }, h('h3', { class: 'sheet__h', text: 'History' }), history),
      h('section', { class: 'sheet__section' }, h('h3', { class: 'sheet__h', text: 'Edit habit' }), editForm),
      dangerBox
    );
  }

  /* ---------- Start ---------- */

  async function boot() {
    if (!state.token) return renderAuth('login');
    try {
      const me = await api('/api/auth/me');
      state.user = me.user;
      await loadDashboard();
    } catch (err) {
      if (state.token) {
        // Not a sign-in problem (api() already handled 401), so show what happened.
        $app.replaceChildren(
          h('div', { class: 'page' }, h('p', { class: 'form__error', role: 'alert', text: err.message }), h('button', { class: 'btn', type: 'button', onclick: boot, text: 'Try again' }))
        );
      }
    }
  }

  boot();
})();
