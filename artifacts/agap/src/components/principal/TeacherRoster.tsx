import { useApp } from '@/context/AppContext';
import { useState } from 'react';
import { TeacherProfile } from '@/lib/seedData';
import { Modal } from '@/components/Modal';

export function TeacherRoster() {
  const { state, dispatch } = useApp();
  const [editingTeacher, setEditingTeacher] = useState<TeacherProfile | 'new' | null>(null);

  const [name, setName] = useState('');
  const [section, setSection] = useState('');
  const [room, setRoom] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');

  const roster = state.teacherRoster;

  const openEdit = (t: TeacherProfile) => {
    setName(t.name);
    setSection(t.section);
    setRoom(t.defaultRoom);
    setStatus(t.status);
    setEditingTeacher(t);
  };

  const openNew = () => {
    setName('');
    setSection('');
    setRoom('');
    setStatus('active');
    setEditingTeacher('new');
  };

  const handleDelete = (id: string) => {
    if (confirm("Remove this teacher from roster?")) {
      dispatch({ type: 'DELETE_TEACHER', payload: id });
    }
  };

  const handleSave = () => {
    if (editingTeacher === 'new') {
      dispatch({
        type: 'ADD_TEACHER',
        payload: {
          id: `t${Date.now()}`,
          name,
          section,
          defaultRoom: room,
          building: 'Bldg A',
          floor: 'Flr 1',
          gpsCoords: '',
          status,
          role: 'teacher'
        }
      });
    } else if (editingTeacher) {
      dispatch({
        type: 'UPDATE_TEACHER_PROFILE',
        payload: {
          id: editingTeacher.id,
          name,
          section,
          defaultRoom: room,
          status,
        }
      });
    }
    setEditingTeacher(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Teacher Roster & Section Mapping</p>
        <button onClick={openNew} className="text-[9.5px] font-bold text-red-600">+ Add</button>
      </div>
      
      {roster.map((t) => (
        <div key={t.id} className="bg-white border border-slate-200 rounded-xl p-2.5 mb-1.5">
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <p className="text-[11.5px] font-bold text-slate-800">{t.name}</p>
              <p className="text-[9.5px] text-slate-500">{t.section}</p>
              <p className="text-[9px] text-slate-400">📍 {t.defaultRoom}</p>
            </div>
            <span className={`text-[8px] font-bold rounded-full px-1.5 py-0.5 shrink-0 ${t.status === 'active' ? 'text-emerald-600 bg-emerald-50' : 'text-slate-500 bg-slate-100'}`}>
              {t.status === 'active' ? 'On Duty' : 'Inactive'}
            </span>
          </div>
          <div className="flex gap-1.5 mt-1.5">
            <button onClick={() => openEdit(t)} className="flex-1 bg-slate-100 text-slate-600 rounded-lg py-1 text-[9.5px] font-bold hover:bg-slate-200 transition-colors">Edit</button>
            <button onClick={() => handleDelete(t.id)} className="flex-1 bg-red-50 text-red-600 rounded-lg py-1 text-[9.5px] font-bold hover:bg-red-100 transition-colors">Delete</button>
          </div>
        </div>
      ))}

      {editingTeacher && (
        <Modal title={editingTeacher === 'new' ? "Add Teacher" : "Edit Profile"} onClose={() => setEditingTeacher(null)}>
          <div className="space-y-3">
            <div>
              <label className="text-[9.5px] font-semibold text-slate-500">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full mt-0.5 border border-slate-200 rounded-lg px-2.5 py-2 text-[12.5px] outline-none focus:border-red-400" />
            </div>
            <div>
              <label className="text-[9.5px] font-semibold text-slate-500">Section</label>
              <input value={section} onChange={(e) => setSection(e.target.value)} className="w-full mt-0.5 border border-slate-200 rounded-lg px-2.5 py-2 text-[12.5px] outline-none focus:border-red-400" />
            </div>
            <div>
              <label className="text-[9.5px] font-semibold text-slate-500">Room</label>
              <input value={room} onChange={(e) => setRoom(e.target.value)} className="w-full mt-0.5 border border-slate-200 rounded-lg px-2.5 py-2 text-[12.5px] outline-none focus:border-red-400" />
            </div>
            <div>
              <label className="text-[9.5px] font-semibold text-slate-500">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="w-full mt-0.5 border border-slate-200 rounded-lg px-2.5 py-2 text-[12.5px] outline-none focus:border-red-400 bg-white">
                <option value="active">Active / On Duty</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <button onClick={handleSave} className="w-full bg-red-600 text-white rounded-lg py-2.5 text-[12.5px] font-bold mt-1">
              Save Profile
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}