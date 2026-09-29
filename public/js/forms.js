// Reusable create/edit dialogs used across several pages.
import {
  api, formDialog, levelOptions, peopleOptions, areaOptions, invalidateCaches, today,
  FREQ_LABEL, STATUS_LABEL, KIND_LABEL,
} from './lib.js';

export async function editPerson(person = null) {
  const areas = await areaOptions();
  const campuses = areas.filter((a) => a.kind === 'campus');
  const fields = [
    { name: 'first_name', label: 'First name', required: true },
    { name: 'last_name', label: 'Last name' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'campus_id', label: 'Campus', type: 'select', options: [['', '—'], ...campuses.map((c) => [String(c.id), c.name])] },
    { name: 'level', label: 'Pipeline level', type: 'select', options: levelOptions(), default: '1' },
    { name: 'status', label: 'Status', type: 'select', options: Object.entries(STATUS_LABEL) },
    { name: 'break_until', label: 'On break until', type: 'date', help: 'Optional, when status is “On break”.' },
    { name: 'joined_date', label: 'Started serving', type: 'date' },
    { name: 'last_break_date', label: 'Last break from serving', type: 'date', help: 'Used for the “no recent break” check.' },
    { name: 'external_id', label: 'External ID', help: 'e.g. Planning Center person ID, for imports.' },
    { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
  ];
  if (person) fields.push({ name: 'level_note', label: 'Reason for level change (if changed)', wide: true });
  return formDialog({
    title: person ? `Edit ${person.name}` : 'Add person',
    fields,
    values: person || {},
    onSubmit: async (v) => {
      const r = person ? await api(`/people/${person.id}`, { method: 'PUT', body: v }) : await api('/people', { method: 'POST', body: v });
      invalidateCaches();
      return person ? { id: person.id } : r;
    },
  });
}

export async function editAssignment({ assignment = null, personId = null, areaId = null } = {}) {
  const [people, areas] = await Promise.all([peopleOptions(), areaOptions()]);
  const fields = [];
  if (!personId) fields.push({ name: 'person_id', label: 'Person', type: 'person', people, required: true, wide: true });
  if (!areaId) {
    fields.push({
      name: 'area_id', label: 'Area', type: 'select', required: true, wide: true,
      options: areas.map((a) => [String(a.id), `${a.path} (${KIND_LABEL[a.kind]})`]),
    });
  }
  fields.push(
    { name: 'role', label: 'Role / position', required: true, help: 'e.g. Team Leader, Greeter, Coach, Director' },
    {
      name: 'role_level', label: 'Level this role requires', type: 'select', options: levelOptions(), default: '1',
      help: 'Level 1 = serving; 2+ = leadership role.',
    },
    { name: 'frequency', label: 'How often', type: 'select', options: Object.entries(FREQ_LABEL) },
    { name: 'hours', label: 'Hours each time', type: 'number', step: '0.5', min: 0, default: '2', help: 'Include prep, meetings and travel.' },
    { name: 'start_date', label: 'Start date', type: 'date', default: assignment ? '' : today() },
    { name: 'end_date', label: 'End date', type: 'date', help: 'Set this when they step off the role.' },
    { name: 'notes', label: 'Notes', type: 'textarea', wide: true, rows: 2 },
  );
  return formDialog({
    title: assignment ? 'Edit role' : 'Add role',
    fields,
    values: assignment || {},
    onSubmit: async (v) => {
      const body = { ...v };
      if (personId) body.person_id = personId;
      if (areaId) body.area_id = areaId;
      if (assignment) await api(`/assignments/${assignment.id}`, { method: 'PUT', body });
      else await api('/assignments', { method: 'POST', body });
      invalidateCaches();
    },
  });
}

export async function editArea({ area = null, parentId = null } = {}) {
  const areas = await areaOptions();
  return formDialog({
    title: area ? `Edit ${area.name}` : 'Add area',
    fields: [
      { name: 'name', label: 'Name', required: true },
      {
        name: 'kind', label: 'Type', type: 'select', options: Object.entries(KIND_LABEL),
        default: 'team',
      },
      {
        name: 'parent_id', label: 'Inside', type: 'select', wide: true,
        options: [['', '— (top level)'], ...areas.filter((a) => a.id !== area?.id).map((a) => [String(a.id), a.path])],
      },
      { name: 'description', label: 'Description', type: 'textarea', wide: true },
    ],
    values: area || { parent_id: parentId },
    onSubmit: async (v) => {
      const r = area ? await api(`/areas/${area.id}`, { method: 'PUT', body: v }) : await api('/areas', { method: 'POST', body: v });
      invalidateCaches();
      return r;
    },
  });
}

export async function editApprenticeship({ apprenticeship = null, leaderId = null, apprenticeId = null, areaId = null } = {}) {
  const [people, areas] = await Promise.all([peopleOptions(), areaOptions()]);
  const fields = [];
  if (!leaderId || apprenticeship) fields.push({ name: 'leader_id', label: 'Leader (developing them)', type: 'person', people, required: true, wide: true });
  if (!apprenticeId || apprenticeship) fields.push({ name: 'apprentice_id', label: 'Apprentice', type: 'person', people, required: true, wide: true });
  fields.push(
    { name: 'area_id', label: 'For which area', type: 'select', wide: true, options: [['', '— (general)'], ...areas.map((a) => [String(a.id), a.path])] },
    { name: 'target_level', label: 'Developing toward', type: 'select', options: levelOptions(), default: '2' },
    { name: 'start_date', label: 'Started', type: 'date', default: today() },
    { name: 'status', label: 'Status', type: 'select', options: [['active', 'Active'], ['completed', 'Completed'], ['stopped', 'Stopped']] },
    { name: 'notes', label: 'Notes', type: 'textarea', wide: true, rows: 2 },
  );
  return formDialog({
    title: apprenticeship ? 'Edit apprenticeship' : 'Add apprenticeship',
    intro: 'Every leader should be developing someone. An apprentice is being prepared to take on a role at the target level.',
    fields,
    values: apprenticeship || { leader_id: leaderId, apprentice_id: apprenticeId, area_id: areaId },
    onSubmit: async (v) => {
      const body = { leader_id: leaderId, apprentice_id: apprenticeId, ...v };
      if (apprenticeship) await api(`/apprenticeships/${apprenticeship.id}`, { method: 'PUT', body });
      else await api('/apprenticeships', { method: 'POST', body });
    },
  });
}

export function logCheckin(person) {
  const scale = (low, high) => [['', '—'], ['1', `1 · ${low}`], ['2', '2'], ['3', '3'], ['4', '4'], ['5', `5 · ${high}`]];
  return formDialog({
    title: `Check-in with ${person.name}`,
    intro: 'A short, regular conversation: How are you doing? How is your capacity? What do you need?',
    fields: [
      { name: 'date', label: 'Date', type: 'date', default: today(), required: true },
      { name: 'conducted_by', label: 'Conducted by', help: 'Defaults to you.' },
      { name: 'capacity', label: 'Capacity / margin', type: 'select', options: scale('Running on empty', 'Plenty of margin') },
      { name: 'spiritual_health', label: 'Spiritual health', type: 'select', options: scale('Struggling', 'Thriving') },
      { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
      { name: 'next_steps', label: 'Next steps', type: 'textarea', wide: true, rows: 2 },
    ],
    onSubmit: (v) => api(`/people/${person.id}/checkins`, { method: 'POST', body: v }),
  });
}
