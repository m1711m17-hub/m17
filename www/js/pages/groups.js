import { h, icon, avatar, clear, toast, timeAgo, hhmm, dayLabel, sheet, actionSheet, confirmBox } from '../lib/dom.js';
import { sb, state, PROFILE_MINI, rt, bus } from '../api.js';
import { headerBar, bellButton } from './home.js';
import { pickPeople } from './people.js';

function groupAvatar(group, size = 50) {
  return avatar({ display_name: group.name, username: group.id, avatar_url: group.avatar_url }, size);
}

function missingSchemaMessage(error) {
  const message = String(error?.message || error || '');
  if (/relation .* does not exist|schema cache|could not find the table/i.test(message)) {
    return 'قسم المجموعات يحتاج تفعيل قاعدة البيانات أولاً. شغّل ملف database/groups.sql في Supabase SQL Editor.';
  }
  return message || 'تعذّر تحميل المجموعات';
}

export async function groupsPage(root) {
  const list = h('div', { class: 'card-list' });
  const createBtn = h('button', { class: 'icon-btn accent', type: 'button', 'aria-label': 'إنشاء مجموعة', onclick: createGroup }, icon('plus', 23));
  root.append(
    headerBar('المجموعات', { back: true, right: [createBtn, bellButton()] }),
    h('div', { class: 'page' },
      h('p', { class: 'muted small group-intro' }, 'اجمع أصدقاءك في محادثة واحدة، وشارك الرسائل معهم بسهولة.'),
      list)
  );

  let stopped = false;
  let loading = false;

  async function load() {
    if (loading || stopped) return;
    loading = true;
    try {
      const mine = await sb.from('group_members').select('group_id,role').eq('user_id', state.me.id).order('joined_at', { ascending: false }).limit(200);
      const ids = [...new Set(mine.map((row) => row.group_id))];
      clear(list);
      if (!ids.length) {
        list.append(h('div', { class: 'empty' }, icon('users', 46),
          h('h3', null, 'لا توجد مجموعات بعد'),
          h('p', null, 'أنشئ مجموعة جديدة وابدأ جمع أصدقائك في مكان واحد.'),
          h('button', { class: 'btn primary', type: 'button', onclick: createGroup }, icon('plus', 18), 'إنشاء مجموعة')));
        return;
      }

      const [groups, messages, members] = await Promise.all([
        sb.from('groups').select('*').in('id', ids).order('updated_at', { ascending: false }).limit(100),
        sb.from('group_messages').select('group_id,body,media_url,media_type,created_at').in('group_id', ids).order('created_at', { ascending: false }).limit(300),
        sb.from('group_members').select('group_id,user_id').in('group_id', ids).limit(2000),
      ]);
      const lastByGroup = new Map();
      messages.forEach((message) => { if (!lastByGroup.has(message.group_id)) lastByGroup.set(message.group_id, message); });
      const countByGroup = new Map();
      members.forEach((member) => countByGroup.set(member.group_id, (countByGroup.get(member.group_id) || 0) + 1));
      const roleByGroup = new Map(mine.map((row) => [row.group_id, row.role]));

      if (!groups.length) {
        list.append(h('div', { class: 'empty small' }, 'لا توجد مجموعات متاحة حالياً'));
        return;
      }
      groups.forEach((group) => {
        const last = lastByGroup.get(group.id);
        const preview = last ? (last.body || (last.media_type === 'video' ? '🎬 فيديو' : '🖼️ صورة')) : (group.description || 'ابدأ أول رسالة في المجموعة');
        const meta = last?.created_at || group.updated_at || group.created_at;
        const count = countByGroup.get(group.id) || 1;
        list.append(h('a', { class: 'user-row conv group-row', href: '#/group/' + group.id },
          groupAvatar(group, 52),
          h('div', { class: 'grow' },
            h('div', { class: 'row between' },
              h('b', { class: 'ellipsis' }, group.name),
              h('span', { class: 'muted small' }, timeAgo(meta))),
            h('div', { class: 'row between' },
              h('span', { class: 'muted ellipsis' }, preview),
              h('span', { class: 'muted small' }, count + ' أعضاء' + (roleByGroup.get(group.id) === 'admin' ? ' · مشرف' : ''))))));
      });
    } catch (error) {
      clear(list).append(h('div', { class: 'empty' }, icon('users', 42),
        h('h3', null, 'تعذّر فتح المجموعات'),
        h('p', null, missingSchemaMessage(error))));
    } finally {
      loading = false;
    }
  }

  function createGroup() {
    sheet('إنشاء مجموعة', (body, close) => {
      const name = h('input', { class: 'input', maxlength: 60, placeholder: 'اسم المجموعة', autocomplete: 'off' });
      const description = h('textarea', { class: 'input', rows: 3, maxlength: 160, placeholder: 'وصف المجموعة (اختياري)' });
      const chosen = new Set();
      const chosenLabel = h('div', { class: 'muted small' }, 'لم يتم اختيار أعضاء إضافيين');
      const pickBtn = h('button', { class: 'btn ghost block', type: 'button', onclick: async () => {
        const ids = await pickPeople('اختيار أعضاء المجموعة');
        if (!ids) return;
        chosen.clear();
        ids.forEach((id) => chosen.add(id));
        chosenLabel.textContent = chosen.size ? 'تم اختيار ' + chosen.size + ' عضو' : 'سيتم إنشاء المجموعة بك فقط';
      } }, icon('users', 18), 'اختيار الأعضاء');
      const save = h('button', { class: 'btn primary block lg', type: 'button', onclick: async () => {
        const groupName = name.value.trim();
        if (!groupName) { toast('اكتب اسم المجموعة أولاً', 'err'); name.focus(); return; }
        save.disabled = true;
        try {
          const result = await sb.rpc('create_group', {
            p_name: groupName,
            p_description: description.value.trim(),
            p_member_ids: [...chosen],
          });
          const id = typeof result === 'string' ? result : result?.id;
          close();
          toast('تم إنشاء المجموعة بنجاح', 'ok');
          location.hash = id ? '#/group/' + id : '#/groups';
        } catch (error) {
          toast(error.message || 'تعذّر إنشاء المجموعة', 'err');
          save.disabled = false;
        }
      } }, 'إنشاء المجموعة');
      body.append(
        h('label', { class: 'lbl' }, 'اسم المجموعة'),
        name,
        h('label', { class: 'lbl' }, 'الوصف'),
        description,
        pickBtn,
        chosenLabel,
        save
      );
      name.focus();
    }, { full: true });
  }

  createBtn.onclick = createGroup;
  await load();
  const timer = setInterval(() => { if (!document.hidden) load(); }, 12000);
  return () => { stopped = true; clearInterval(timer); };
}

export async function groupChatPage(root, params) {
  root.classList.add('chat-root');
  let group, membership, memberRows = [];
  const people = new Map();

  async function refreshMembers() {
    memberRows = await sb.from('group_members').select('user_id,role,joined_at').eq('group_id', params.id).order('joined_at', { ascending: true }).limit(200);
    const ids = memberRows.map((row) => row.user_id);
    const profiles = ids.length ? await sb.from('profiles').select(PROFILE_MINI).in('id', ids).limit(200) : [];
    people.clear();
    profiles.forEach((profile) => people.set(profile.id, profile));
    return memberRows;
  }

  try {
    group = await sb.from('groups').select('*').eq('id', params.id).one();
    if (!group) throw new Error('المجموعة غير موجودة أو لم تعد متاحة');
    membership = await sb.from('group_members').select('role').eq('group_id', params.id).eq('user_id', state.me.id).one();
    if (!membership) throw new Error('أنت لست عضواً في هذه المجموعة');
    await refreshMembers();
  } catch (error) {
    root.classList.remove('chat-root');
    root.append(headerBar('المجموعة', { back: true }), h('div', { class: 'empty' }, icon('users', 42), h('p', null, missingSchemaMessage(error))));
    return;
  }

  const messages = h('div', { class: 'chat-msgs' });
  const input = h('textarea', { class: 'input chat-input', rows: 1, maxlength: 2000, placeholder: 'اكتب رسالة للمجموعة...' });
  const sendBtn = h('button', { class: 'icon-btn accent', type: 'button', 'aria-label': 'إرسال الرسالة', onclick: send }, icon('send', 22));
  const memberCount = h('div', { class: 'muted small' }, memberRows.length + ' أعضاء');
  const title = h('div', { class: 'group-title' }, h('b', null, group.name), memberCount);
  const moreBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'خيارات المجموعة', onclick: openGroupMenu }, icon('more', 22));

  root.append(headerBar(title, { back: true, right: [moreBtn] }), messages, h('div', { class: 'chat-bar' }, input, sendBtn));

  const seen = new Set();
  let lastDay = '';
  let busy = false;
  let sending = false;
  let stopped = false;
  let channel = null;

  function addRows(rows) {
    const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 160;
    let added = false;
    rows.forEach((message) => {
      if (!message || seen.has(message.id)) return;
      seen.add(message.id);
      const day = dayLabel(message.created_at);
      if (day !== lastDay) {
        lastDay = day;
        messages.append(h('div', { class: 'day-sep' }, day));
      }
      const mine = message.sender_id === state.me.id;
      const sender = people.get(message.sender_id);
      const content = [];
      if (!mine) content.push(h('b', { class: 'group-sender' }, sender?.display_name || sender?.username || 'عضو'));
      content.push(h('div', { class: 'b-text' }, message.body || (message.media_type === 'video' ? '🎬 فيديو' : '🖼️ صورة')));
      content.push(h('div', { class: 'b-meta' }, hhmm(message.created_at)));
      messages.append(h('div', { class: 'bubble ' + (mine ? 'me' : 'them') }, ...content));
      added = true;
    });
    if (added && (nearBottom || seen.size <= rows.length)) messages.scrollTop = messages.scrollHeight;
  }

  async function poll() {
    if (busy || stopped) return;
    busy = true;
    try {
      const rows = await sb.from('group_messages').select('*').eq('group_id', params.id).order('created_at', { ascending: false }).limit(80);
      addRows(rows.reverse());
    } catch (error) {
      if (!messages.children.length) messages.append(h('div', { class: 'empty small' }, missingSchemaMessage(error)));
    } finally {
      busy = false;
    }
  }

  async function send() {
    const body = input.value.trim();
    if (!body || sending) return;
    sending = true;
    sendBtn.disabled = true;
    try {
      await sb.from('group_messages').insert({ group_id: params.id, sender_id: state.me.id, body });
      input.value = '';
      input.style.height = '';
      await poll();
      messages.scrollTop = messages.scrollHeight;
    } catch (error) {
      toast(error.message || 'تعذّر إرسال الرسالة', 'err');
    } finally {
      sending = false;
      sendBtn.disabled = false;
      input.focus({ preventScroll: true });
    }
  }

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(120, input.scrollHeight) + 'px';
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });

  async function showMembers() {
    try {
      await refreshMembers();
      sheet('أعضاء ' + group.name, (body) => {
        if (!memberRows.length) body.append(h('div', { class: 'empty small' }, 'لا يوجد أعضاء'));
        memberRows.forEach((row) => {
          const person = people.get(row.user_id) || { username: 'member', display_name: 'عضو' };
          body.append(h('div', { class: 'user-row' }, avatar(person, 40),
            h('div', { class: 'grow' }, h('b', null, person.display_name || person.username),
              h('div', { class: 'muted small' }, '@' + (person.username || ''))),
            h('span', { class: 'muted small' }, row.role === 'admin' ? 'مشرف' : 'عضو')));
        });
      }, { full: true });
    } catch (error) { toast(error.message, 'err'); }
  }

  async function addMembers() {
    const selected = await pickPeople('إضافة أعضاء إلى ' + group.name);
    if (!selected || !selected.size) return;
    try {
      const added = await sb.rpc('add_group_members', { p_group_id: params.id, p_member_ids: [...selected] });
      await refreshMembers();
      memberCount.textContent = memberRows.length + ' أعضاء';
      toast('تمت إضافة ' + Number(added || 0) + ' عضو', 'ok');
    } catch (error) { toast(error.message || 'تعذّرت إضافة الأعضاء', 'err'); }
  }

  async function leaveGroup() {
    if (!(await confirmBox('هل تريد مغادرة هذه المجموعة؟ لن تتمكن من قراءة رسائلها بعد المغادرة.', 'مغادرة المجموعة', true))) return;
    try {
      await sb.rpc('leave_group', { p_group_id: params.id });
      toast('غادرت المجموعة');
      location.hash = '#/groups';
    } catch (error) { toast(error.message || 'تعذّرت مغادرة المجموعة', 'err'); }
  }

  function openGroupMenu() {
    const actions = [{ label: 'عرض الأعضاء (' + memberRows.length + ')', icon: 'users', run: showMembers }];
    if (membership.role === 'admin') actions.push({ label: 'إضافة أعضاء', icon: 'user-plus', run: addMembers });
    actions.push({ label: 'مغادرة المجموعة', icon: 'log-out', danger: true, run: leaveGroup });
    actionSheet(group.name, actions);
  }

  function attachRealtime() {
    if (channel || !rt) return;
    channel = rt.channel('group-' + params.id, {
      pg: [{ event: 'INSERT', table: 'group_messages', filter: 'group_id=eq.' + params.id }],
    }).onPg('INSERT', 'group_messages', (data) => {
      if (data.record?.group_id === params.id) addRows([data.record]);
    }).onReady(poll).subscribe();
  }

  attachRealtime();
  bus.addEventListener('rt:ready', attachRealtime);
  await poll();
  let ticks = 0;
  const timer = setInterval(() => {
    if (document.hidden) return;
    ticks++;
    if (!channel?.ready || ticks % 6 === 0) poll();
  }, 5000);

  return () => {
    stopped = true;
    clearInterval(timer);
    bus.removeEventListener('rt:ready', attachRealtime);
    channel?.unsubscribe();
    root.classList.remove('chat-root');
  };
}
