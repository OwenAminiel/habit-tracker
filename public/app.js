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
    for (const kid of kids.flat(Infinity)) {
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

  const state = {
    token: store.get(), user: null, today: isoLocal(new Date()), habits: [],
    detailId: null, detailEntries: [], detailStats: null,
    view: 'today', archived: null, showArchived: false, overview: null,
  };

  /* ---------- Schedules ---------- */

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function scheduleText(habit) {
    if (habit.frequency === 'days') return (habit.days_of_week || []).map((d) => WEEKDAYS[d]).join(', ');
    if (habit.frequency === 'weekly') return `${habit.times_per_week} ${habit.times_per_week === 1 ? 'time' : 'times'} a week`;
    return 'Every day';
  }

  // Does this schedule expect a check-in on this date? Weekly goals have no fixed days.
  function isRequired(habit, date) {
    if (habit.frequency === 'days') return (habit.days_of_week || []).includes(parseISO(date).getDay());
    if (habit.frequency === 'weekly') return false;
    return true;
  }


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

  function cellState(date, done, createdDate, today, required = true) {
    if (done) return 'done';
    if (date < createdDate) return 'before';
    if (!required) return 'rest';
    if (date === today) return 'pending';
    return 'missed';
  }

  // A day only counts as missed after the habit began: its creation day, or the earliest day logged if that is sooner.
  function startOf(createdDate, doneDates) {
    return doneDates.reduce((min, d) => (d < min ? d : min), createdDate);
  }

  function chainCells(days, createdDate, today, extraClass) {
    const start = startOf(createdDate, days.filter((d) => d.completed).map((d) => d.date));
    const states = days.map((d) => cellState(d.date, d.completed, start, today, d.required !== false));
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
    state.view = 'today';
    state.archived = null;
    state.showArchived = false;
    store.clear();
    if ($dialog.open) $dialog.close();
    $dialog.replaceChildren();
    renderAuth('login', typeof notice === 'string' ? notice : undefined);
  }

  /* ---------- Page shell and navigation ---------- */

  const NAV = [['today', 'Today'], ['insights', 'Insights'], ['settings', 'Settings']];

  function shell(...content) {
    return [
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
          'nav',
          { class: 'nav', 'aria-label': 'Main' },
          NAV.map(([id, label]) =>
            h('button', {
              class: 'nav__link', type: 'button', text: label,
              'aria-current': state.view === id ? 'page' : null,
              onclick: () => go(id),
            })
          )
        ),
        h(
          'div',
          { class: 'topbar__user' },
          h('span', { class: 'topbar__email', text: state.user ? state.user.email : '' }),
          h('button', { class: 'btn btn--quiet btn--small', type: 'button', onclick: () => signOut(), text: 'Log out' })
        )
      ),
      h('main', { class: 'page' }, content),
    ];
  }

  async function go(view) {
    state.view = view;
    try {
      if (view === 'today') await loadDashboard();
      else if (view === 'insights') await loadInsights();
      else renderSettings();
      window.scrollTo(0, 0);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /* ---------- Today ---------- */

  async function loadDashboard(focusId) {
    state.today = isoLocal(new Date());
    const data = await api(`/api/habits/summary?today=${state.today}`);
    state.habits = data.habits;
    if (state.view === 'today' || !$app.firstChild) renderDashboard(focusId);
  }

  function renderDashboard(focusId) {
    state.view = 'today';
    // Habits with a fixed day count towards "today" only when that day is one of their days (or already done).
    const due = state.habits.filter((x) => x.required_today || x.completed_today);
    const done = due.filter((x) => x.completed_today).length;
    const total = due.length;

    const sub =
      state.habits.length === 0
        ? 'Nothing to check in yet.'
        : total === 0
          ? 'Nothing is due today. Enjoy the rest day.'
          : done === total
            ? h('span', {}, h('strong', { text: 'All done' }), ` for today. ${total} of ${total} checked in.`)
            : h('span', {}, h('strong', { text: `${done} of ${total}` }), ' checked in today.');

    const list =
      state.habits.length === 0
        ? h(
            'div',
            { class: 'empty' },
            h('h2', { class: 'empty__title', text: 'No habits yet' }),
            h('p', { class: 'empty__text', text: 'Add something you want to do. Each check-in adds a link to its chain.' }),
            h('button', { class: 'btn', type: 'button', onclick: openNewHabit, text: 'Add your first habit' })
          )
        : h('ul', { class: 'habits', 'aria-label': 'Your habits' }, state.habits.map(habitRow));

    $app.replaceChildren(
      ...shell(
        h(
          'div',
          { class: 'page__head' },
          h(
            'div',
            {},
            h('h1', { class: 'page__title', text: 'Today' }),
            h('p', { class: 'page__sub' }, fmt(state.today, { weekday: 'long', month: 'long', day: 'numeric' }), ' – ', sub)
          ),
          state.habits.length > 0 ? h('button', { class: 'btn', type: 'button', onclick: openNewHabit, text: 'New habit' }) : null
        ),
        list,
        archivedSection()
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
    const rest = habit.frequency === 'days' && !habit.required_today && !habit.completed_today;

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

    const meta = [h('span', { class: 'tag', text: scheduleText(habit) })];
    if (rest) meta.push(h('span', { class: 'tag tag--rest', text: 'Rest day' }));
    if (habit.frequency === 'weekly') {
      const met = habit.week_count >= habit.week_goal;
      meta.push(
        h('span', { class: met ? 'tag tag--met' : 'tag', text: `${habit.week_count} of ${habit.week_goal} this week` })
      );
    }

    return h(
      'li',
      { class: rest ? 'habit habit--rest' : 'habit' },
      check,
      h(
        'button',
        { class: 'habit__info', type: 'button', dataset: { id: habit.id }, onclick: () => openDetail(habit.id) },
        h('span', { class: 'habit__name', text: habit.name }),
        habit.description ? h('span', { class: 'habit__desc', text: habit.description }) : null,
        h('span', { class: 'habit__meta' }, meta)
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
        h('span', { class: 'streak__unit', text: broken ? 'streak broken' : `${habit.streak_unit} streak` })
      )
    );
  }

  /* Archived habits: hidden by default, listed on request, restorable. */
  function archivedSection() {
    const toggle = h('button', {
      class: 'btn btn--quiet btn--small', type: 'button', 'aria-expanded': String(state.showArchived),
      text: state.showArchived ? 'Hide archived habits' : 'Show archived habits',
      onclick: async () => {
        state.showArchived = !state.showArchived;
        if (state.showArchived) {
          try { await loadArchived(); } catch (err) { toast(err.message, 'error'); state.showArchived = false; }
        }
        renderDashboard();
      },
    });
    const body = [];
    if (state.showArchived && state.archived) {
      body.push(
        state.archived.length === 0
          ? h('p', { class: 'sheet__note', text: 'No archived habits.' })
          : h(
              'ul',
              { class: 'archived' },
              state.archived.map((a) =>
                h(
                  'li',
                  { class: 'archived__item' },
                  h('span', { class: 'archived__name' }, h('strong', { text: a.name }), h('span', { class: 'tag', text: scheduleText(a) })),
                  h('button', {
                    class: 'btn btn--quiet btn--small', type: 'button', text: 'Restore',
                    'aria-label': `Restore ${a.name}`,
                    onclick: async () => {
                      try {
                        await api(`/api/habits/${a.id}/restore`, { method: 'POST' });
                        await loadArchived();
                        await loadDashboard();
                        toast('Habit restored');
                      } catch (err) { toast(err.message, 'error'); }
                    },
                  })
                )
              )
            )
      );
    }
    return h('section', { class: 'archive-block' }, toggle, body);
  }

  async function loadArchived() {
    const data = await api('/api/habits?archived=true&limit=100&sort=name&order=asc');
    state.archived = data.habits;
  }

  /* ---------- Insights ---------- */

  async function loadInsights() {
    state.today = isoLocal(new Date());
    state.overview = await api(`/api/stats/overview?today=${state.today}`);
    renderInsights();
  }

  function renderInsights() {
    state.view = 'insights';
    const o = state.overview;
    const rate = (v) => (v == null ? '–' : `${v}%`);

    const card = (num, label, note) =>
      h('div', { class: 'card' }, h('span', { class: 'card__num', text: String(num) }), h('span', { class: 'card__label', text: label }), note ? h('span', { class: 'card__note', text: note }) : null);

    const best = o.best_current_streak;
    const cards = h('div', { class: 'cards' },
      card(`${o.checked_in_today}/${o.active_habits}`, 'Checked in today'),
      card(o.checkins_this_week, 'Check-ins this week'),
      card(rate(o.completion_rate.days_30), '30-day completion'),
      card(best ? best.streak : 0, best ? `Best streak (${best.unit}s)` : 'Best streak', best ? best.name : 'Check in to start one'));

    let body;
    if (o.active_habits === 0 && o.total_checkins === 0) {
      body = h('div', { class: 'empty' },
        h('h2', { class: 'empty__title', text: 'Nothing to chart yet' }),
        h('p', { class: 'empty__text', text: 'Add a habit and check in a few times. Your trends will show up here.' }),
        h('button', { class: 'btn', type: 'button', onclick: () => go('today'), text: 'Go to Today' }));
    } else {
      body = [cards, heatmap(o), weekdayBars(o), habitRates(o)];
    }

    $app.replaceChildren(
      ...shell(
        h('div', { class: 'page__head' }, h('div', {}, h('h1', { class: 'page__title', text: 'Insights' }),
          h('p', { class: 'page__sub', text: `${o.total_checkins} ${o.total_checkins === 1 ? 'check-in' : 'check-ins'} across ${o.active_habits} active ${o.active_habits === 1 ? 'habit' : 'habits'}.` }))),
        body
      )
    );
  }

  /* Twelve weeks of activity: one square per day, darker blue when more habits were done. */
  function heatmap(o) {
    const max = Math.max(1, o.active_habits);
    const level = (n) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
    const cells = o.activity.map((d) =>
      h('span', {
        class: `heat heat--${level(d.count)}`,
        title: `${fmt(d.date, { weekday: 'short', month: 'short', day: 'numeric' })}: ${d.count} ${d.count === 1 ? 'check-in' : 'check-ins'}`,
      })
    );
    const total = o.activity.reduce((n, d) => n + d.count, 0);
    const dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((c) => h('span', { class: 'heatgrid__dow', 'aria-hidden': 'true', text: c }));
    return h('section', { class: 'panel' },
      h('h2', { class: 'panel__title', text: 'Last 12 weeks' }),
      h('p', { class: 'sheet__note', text: `${total} check-ins. Darker squares mean more of your habits were done that day.` }),
      h('div', { class: 'heatwrap', role: 'img', 'aria-label': `Heat map of check-ins for the last 12 weeks, ${total} in total.` },
        h('div', { class: 'heatgrid' }, dow, cells)),
      h('div', { class: 'legend', 'aria-hidden': 'true' },
        h('span', { text: 'Fewer' }), [0, 1, 2, 3, 4].map((l) => h('span', { class: `heat heat--${l}` })), h('span', { text: 'More' })));
  }

  function weekdayBars(o) {
    const max = Math.max(1, ...o.by_weekday.map((d) => d.completed));
    const best = o.by_weekday.reduce((a, b) => (b.completed > a.completed ? b : a), o.by_weekday[0]);
    return h('section', { class: 'panel' },
      h('h2', { class: 'panel__title', text: 'Your best days' }),
      h('p', { class: 'sheet__note', text: best.completed > 0 ? `You check in most on ${WEEKDAYS_LONG[best.day]}s.` : 'Check in to see which days work best.' }),
      h('ul', { class: 'bars' },
        o.by_weekday.map((d) =>
          h('li', { class: 'bar' },
            h('span', { class: 'bar__label', text: WEEKDAYS[d.day] }),
            h('span', { class: 'bar__track' }, h('span', { class: 'bar__fill', style: `width:${Math.round((d.completed / max) * 100)}%` })),
            h('span', { class: 'bar__value', text: String(d.completed) })))));
  }

  function habitRates(o) {
    if (!o.habits.length) return null;
    return h('section', { class: 'panel' },
      h('h2', { class: 'panel__title', text: 'By habit (last 30 days)' }),
      h('ul', { class: 'bars bars--wide' },
        o.habits.map((x) => {
          const r = x.rate_30;
          return h('li', { class: 'bar bar--habit' },
            h('span', { class: 'bar__label' }, h('strong', { text: x.name }), h('span', { class: 'tag', text: `${x.current_streak} ${x.streak_unit} streak` })),
            h('span', { class: 'bar__track' }, h('span', { class: r != null && r < 40 ? 'bar__fill bar__fill--low' : 'bar__fill', style: `width:${r == null ? 0 : r}%` })),
            h('span', { class: 'bar__value', text: r == null ? '–' : `${r}%` }));
        })));
  }

  /* ---------- Settings ---------- */

  function renderSettings() {
    state.view = 'settings';

    /* Change password */
    const pwError = h('p', { class: 'form__error', role: 'alert' });
    const cur = h('input', { class: 'input', id: 'pw-current', type: 'password', required: true, autocomplete: 'current-password', maxlength: '72' });
    const next = h('input', { class: 'input', id: 'pw-new', type: 'password', required: true, autocomplete: 'new-password', minlength: '8', maxlength: '72' });
    const pwBtn = h('button', { class: 'btn', type: 'submit', text: 'Change password' });
    const pwForm = h('form', {
      class: 'form', novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        pwError.textContent = '';
        pwBtn.disabled = true;
        try {
          const data = await api('/api/auth/password', { method: 'PUT', body: { current_password: cur.value, new_password: next.value } });
          state.token = data.token;
          store.set(data.token);
          cur.value = '';
          next.value = '';
          toast('Password changed. Other devices were signed out.');
        } catch (err) {
          pwError.textContent = err.message;
        }
        pwBtn.disabled = false;
      },
    },
    h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'pw-current', text: 'Current password' }), cur),
    h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'pw-new', text: 'New password' }), next, h('span', { class: 'field__hint', text: 'At least 8 characters.' })),
    pwError,
    h('div', { class: 'form__actions' }, pwBtn));

    /* Sessions */
    const logoutAll = h('button', {
      class: 'btn btn--quiet', type: 'button', text: 'Log out everywhere',
      onclick: async () => {
        try {
          await api('/api/auth/logout-all', { method: 'POST' });
          signOut('You were signed out on every device. Log in again.');
        } catch (err) { toast(err.message, 'error'); }
      },
    });

    /* Export */
    const download = async (format) => {
      try {
        const res = await fetch(`/api/export?format=${format}`, { headers: { Authorization: `Bearer ${state.token}` } });
        if (res.status === 401) return signOut('Your session ended. Log in again.');
        if (!res.ok) throw new Error('Could not export your data. Try again.');
        const url = URL.createObjectURL(await res.blob());
        const a = h('a', { href: url, download: `habit-tracker-${state.today}.${format}` });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast(`Exported as ${format.toUpperCase()}`);
      } catch (err) { toast(err.message, 'error'); }
    };

    /* Delete account (two steps, password required) */
    const dangerBox = h('div', { class: 'danger' });
    const showDelete = () => dangerBox.replaceChildren(h('button', { class: 'btn btn--danger', type: 'button', text: 'Delete my account', onclick: arm }));
    const arm = () => {
      const err = h('p', { class: 'form__error', role: 'alert' });
      const pw = h('input', { class: 'input', id: 'del-pw', type: 'password', autocomplete: 'current-password', maxlength: '72' });
      const go = h('button', { class: 'btn btn--danger-armed', type: 'submit', text: 'Delete everything for good' });
      dangerBox.replaceChildren(h('form', {
        class: 'form', novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          err.textContent = '';
          go.disabled = true;
          try {
            await api('/api/auth/me', { method: 'DELETE', body: { password: pw.value } });
            signOut('Your account was deleted.');
          } catch (ex) { err.textContent = ex.message; go.disabled = false; }
        },
      },
      h('p', { class: 'sheet__note', text: 'This removes your account, every habit and every check-in. It can’t be undone. Enter your password to confirm.' }),
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'del-pw', text: 'Password' }), pw),
      err,
      h('div', { class: 'form__actions' }, go, h('button', { class: 'btn btn--quiet', type: 'button', text: 'Keep my account', onclick: showDelete }))));
      pw.focus();
    };
    showDelete();

    const panel = (title, ...kids) => h('section', { class: 'panel' }, h('h2', { class: 'panel__title', text: title }), kids);

    $app.replaceChildren(
      ...shell(
        h('div', { class: 'page__head' }, h('div', {}, h('h1', { class: 'page__title', text: 'Settings' }),
          h('p', { class: 'page__sub', text: state.user ? `Signed in as ${state.user.email}` : '' }))),
        h('div', { class: 'settings' },
          panel('Password', pwForm),
          panel('Sessions', h('p', { class: 'sheet__note', text: 'Signs you out of this browser and every other device where you are logged in.' }), logoutAll),
          panel('Your data', h('p', { class: 'sheet__note', text: 'Download every habit and check-in, including archived habits.' }),
            h('div', { class: 'form__actions' },
              h('button', { class: 'btn btn--quiet', type: 'button', text: 'Download JSON', onclick: () => download('json') }),
              h('button', { class: 'btn btn--quiet', type: 'button', text: 'Download CSV', onclick: () => download('csv') }))),
          panel('Delete account', dangerBox))
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

  /* Schedule picker: every day, certain weekdays, or a number of times a week. */
  function schedulePicker(initial = {}) {
    const uid = `sch${Math.random().toString(36).slice(2, 7)}`;
    let mode = initial.frequency || 'daily';
    const selected = new Set(initial.days_of_week || []);
    const times = h('select', { class: 'input input--select', id: `${uid}-times`, 'aria-label': 'Times per week' },
      [1, 2, 3, 4, 5, 6, 7].map((n) => h('option', { value: String(n), text: `${n} ${n === 1 ? 'time' : 'times'} a week`, selected: n === (initial.times_per_week || 3) })));
    const dayRow = h('div', { class: 'days', role: 'group', 'aria-label': 'Days of the week' },
      WEEKDAYS.map((name, i) =>
        h('button', {
          class: 'daybtn', type: 'button', text: name, 'aria-pressed': String(selected.has(i)), 'aria-label': WEEKDAYS_LONG[i],
          onclick: (e) => {
            if (selected.has(i)) selected.delete(i); else selected.add(i);
            e.currentTarget.setAttribute('aria-pressed', String(selected.has(i)));
          },
        })
      ));
    const detail = h('div', { class: 'schedule__detail' });
    const modes = [['daily', 'Every day'], ['days', 'Certain days'], ['weekly', 'Times a week']];
    const radios = modes.map(([value, label]) =>
      h('label', { class: 'choice' },
        h('input', { type: 'radio', name: `${uid}-mode`, value, checked: value === mode, onchange: () => { mode = value; sync(); } }),
        h('span', { text: label }))
    );
    function sync() {
      detail.replaceChildren(...(mode === 'days' ? [dayRow] : mode === 'weekly' ? [times] : []));
    }
    sync();
    return {
      el: h('fieldset', { class: 'schedule' }, h('legend', { class: 'field__label', text: 'How often' }), h('div', { class: 'choices' }, radios), detail),
      value() {
        if (mode === 'days') return { frequency: 'days', days_of_week: [...selected].sort((a, b) => a - b) };
        if (mode === 'weekly') return { frequency: 'weekly', times_per_week: Number(times.value) };
        return { frequency: 'daily' };
      },
    };
  }

  function openNewHabit() {
    state.detailId = null;
    const error = h('p', { class: 'form__error', role: 'alert' });
    const name = h('input', { class: 'input', id: 'new-name', required: true, maxlength: '100', placeholder: 'Read for 20 minutes' });
    const desc = h('textarea', { class: 'input', id: 'new-desc', maxlength: '500' });
    const save = h('button', { class: 'btn', type: 'submit', text: 'Add habit' });
    const picker = schedulePicker();

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
              await api('/api/habits', { method: 'POST', body: { name: name.value, description: desc.value, ...picker.value() } });
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
        picker.el,
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
    const [, entries, stats] = await Promise.all([
      loadDashboard(),
      api(`/api/habits/${id}/entries?from=${start}&to=${state.today}&limit=500`),
      api(`/api/habits/${id}/stats?today=${state.today}`),
    ]);
    state.detailStats = stats;
    const habit = state.habits.find((x) => x.id === id);
    if (!habit) { if ($dialog.open) $dialog.close(); return; }
    state.detailEntries = entries.entries;
    renderDetail(habit);
    $dialog.scrollTop = scroll;
  }

  /* Completion rates, this week's progress and milestone badges for one habit. */
  function insightsBlock(habit, stats) {
    if (!stats) return null;
    const rate = (v) => (v == null ? '–' : `${v}%`);
    const rates = h('div', { class: 'rates', role: 'list' },
      [['Last 7 days', stats.completion_rate.days_7], ['Last 30 days', stats.completion_rate.days_30], ['Last 90 days', stats.completion_rate.days_90]].map(([label, v]) =>
        h('div', { class: 'rate', role: 'listitem' }, h('span', { class: 'rate__num', text: rate(v) }), h('span', { class: 'rate__label', text: label }))
      ));
    const weekly = habit.frequency === 'weekly'
      ? h('p', { class: 'sheet__note' }, h('strong', { text: `${habit.week_count} of ${habit.week_goal}` }), ' check-ins so far this week (weeks run Sunday to Saturday).')
      : habit.frequency === 'days'
        ? h('p', { class: 'sheet__note', text: `Scheduled: ${scheduleText(habit)}. Other days are rest days.` })
        : null;
    const badges = h('ul', { class: 'badges', 'aria-label': 'Milestones' },
      stats.milestones.map((m) =>
        h('li', { class: m.achieved ? 'badge badge--on' : 'badge' }, h('span', { class: 'sr-only', text: m.achieved ? 'Earned: ' : 'Locked: ' }), m.label)
      ));
    return h('section', { class: 'sheet__section' }, h('h3', { class: 'sheet__h', text: 'Progress' }), rates, weekly, badges);
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
      const s = future ? 'future' : cellState(date, done, createdDate, state.today, isRequired(habit, date) || (habit.frequency === 'daily'));
      const showMonth = i === 0 || parseISO(date).getDate() === 1;
      const dayNum = String(parseISO(date).getDate());
      const label = `${fmt(date, { weekday: 'long', month: 'long', day: 'numeric' })}: ${future ? 'upcoming' : done ? 'done. Select to remove.' : s === 'rest' ? 'not scheduled. Select to check in anyway.' : 'not done. Select to check in.'}`;
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
    const picker = schedulePicker(habit);
    const editForm = h(
      'form',
      {
        class: 'form', novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          editError.textContent = '';
          editBtn.disabled = true;
          try {
            await api(`/api/habits/${habit.id}`, { method: 'PUT', body: { name: name.value, description: desc.value, ...picker.value() } });
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
      picker.el,
      editError,
      h('div', { class: 'form__actions' }, editBtn)
    );

    /* Delete (two steps, so it can't happen by accident) */
    const dangerBox = h('div', { class: 'danger' });
    const showDelete = () => {
      const del = h('button', { class: 'btn btn--danger', type: 'button', text: 'Delete habit', onclick: arm });
      const archive = h('button', {
        class: 'btn btn--quiet', type: 'button', text: 'Archive habit',
        onclick: async () => {
          try {
            await api(`/api/habits/${habit.id}/archive`, { method: 'POST' });
            state.detailId = null;
            state.archived = null;
            $dialog.close();
            await loadDashboard();
            toast('Habit archived. Find it under Show archived habits.');
          } catch (err) { toast(err.message, 'error'); }
        },
      });
      dangerBox.replaceChildren(
        h('p', { class: 'sheet__note', text: 'Archiving hides the habit and keeps its history. You can restore it any time.' }),
        h('div', { class: 'form__actions' }, archive, del)
      );
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
      habit.frequency === 'daily' ? null : h('span', { class: 'legend__item' }, h('span', { class: 'cell cell--rest' }), habit.frequency === 'weekly' ? 'Open day' : 'Rest day'),
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
        stat(habit.current_streak, `${habit.streak_unit} streak`, broken),
        stat(habit.longest_streak, 'Best streak'),
        stat(habit.total_completed, 'Total check-ins')
      ),
      insightsBlock(habit, state.detailStats),
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
