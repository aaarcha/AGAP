import { useState, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import { CategoryGrid } from './CategoryGrid';
import { PopulationToggle } from './PopulationToggle';
import { computeUrgencyScore, getUrgencyBand, calculateLocationRisk, calculateTimeSensitivity } from '@/lib/urgency';
import { MapPin, Wifi, WifiOff, Settings } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { ResponseTracker } from '@/components/ResponseTracker';
import { WaitingLine } from '@/components/WaitingLine';

interface SubmitFlowProps {
  onComplete?: () => void;
}

const NON_CLASSROOM_AREAS = [
  { id: "canteen", label: "Canteen", risk: 3 },
  { id: "quadrangle", label: "Quadrangle", risk: 3 },
  { id: "coveredcourt", label: "Covered Court", risk: 3 },
  { id: "hallway", label: "Hallway", risk: 4 },
  { id: "cr", label: "Comfort Room", risk: 5 },
];

export function SubmitFlow({ onComplete }: SubmitFlowProps) {
  const { state, dispatch } = useApp();
  const user = state.currentUser!;
  
  const [step, setStep] = useState(1);
  const [category, setCategory] = useState<any>(null);
  const [subType, setSubType] = useState<any>(null);
  
  const [population, setPopulation] = useState<any>(null);

  const [actualLocation, setActualLocation] = useState(user.defaultRoom);
  const [showLocationMismatch, setShowLocationMismatch] = useState(false);
  const [mismatch, setMismatch] = useState<any>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [justSent, setJustSent] = useState(false);
  
  const [showProfile, setShowProfile] = useState(false);
  const [profileName, setProfileName] = useState(user.name);
  const [profileSection, setProfileSection] = useState(user.section);
  const [profileRoom, setProfileRoom] = useState(user.defaultRoom);

  const room = user.defaultRoom;
  const gps = user.gpsCoords || "14.312, 121.114";

  const myLastIncident = state.incidents.find(i => i.reporterId === user.id);

  useEffect(() => {
    let timer: number;
    if (countdown !== null && countdown > 0) {
      timer = window.setTimeout(() => setCountdown(countdown - 1), 1000);
    } else if (countdown === 0) {
      executeSubmit();
      setCountdown(null);
    }
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const handleStartSubmit = () => {
    if (!state.connectivity) {
      executeSubmit();
      return;
    }
    setCountdown(5);
  };

  const executeSubmit = () => {
    const locRisk = mismatch ? mismatch.risk : 2;
    const timeSens = calculateTimeSensitivity(0);
    const score = computeUrgencyScore(subType.severity, population.vuln, locRisk, timeSens);
    const band = getUrgencyBand(score, 'open');
    const roomLabel = mismatch ? `${mismatch.label} (reassigned from ${room})` : room;

    dispatch({
      type: 'ADD_INCIDENT',
      payload: {
        category: category.id as any,
        subType: subType.label,
        severity: subType.severity,
        vulnerability: population.vuln,
        locationRisk: locRisk,
        timeSensitivity: timeSens,
        urgencyScore: score,
        urgencyBand: band,
        location: roomLabel,
        reporterId: user.id,
        reporterName: user.name,
        status: 'open',
        confirmedByCount: 1,
        affectedPopulation: population.id,
        linkedSection: user.section,
      }
    });

    setJustSent(true);
    setTimeout(() => setJustSent(false), 4500);
    
    if (onComplete) onComplete();
    setStep(1);
    setCategory(null);
    setSubType(null);
    setPopulation(null);
    setMismatch(null);
  };

  const handleSaveProfile = () => {
    dispatch({
      type: 'UPDATE_TEACHER_PROFILE',
      payload: {
        id: user.id,
        name: profileName,
        section: profileSection,
        defaultRoom: profileRoom,
      }
    });
    setShowProfile(false);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-3 pt-2.5 pb-1.5 shrink-0">
        <div className="bg-white rounded-xl border border-slate-200 px-2.5 py-2 flex items-center gap-2">
          <MapPin size={15} className="text-red-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11.5px] font-bold text-slate-800 truncate">{room}</p>
            <p className="text-[8.5px] font-mono text-emerald-600">GPS Locked: {gps}</p>
          </div>
          {user.role === 'teacher' && (
            <button onClick={() => setShowProfile(true)} className="p-1"><Settings size={15} className="text-slate-400" /></button>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-1.5">
          <button
            onClick={() => setShowLocationMismatch(true)}
            className="text-[8.5px] font-semibold text-orange-600 bg-orange-50 border border-orange-200 rounded-full px-2 py-0.5"
          >⚠ Simulate location mismatch</button>
          <button
            onClick={() => dispatch({ type: 'SET_CONNECTIVITY', payload: !state.connectivity })}
            className={`ml-auto flex items-center gap-1 text-[8.5px] font-semibold rounded-full px-2 py-0.5 border ${state.connectivity ? "text-emerald-600 bg-emerald-50 border-emerald-200" : "text-slate-500 bg-slate-100 border-slate-200"}`}
          >{state.connectivity ? <Wifi size={10} /> : <WifiOff size={10} />} {state.connectivity ? "Online" : "No Connection"}</button>
        </div>
        {mismatch && <p className="text-[8.5px] text-orange-600 mt-1">📍 Reassigned to: {mismatch.label}</p>}
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-2">
        {justSent && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-2">
            <p className="text-[11.5px] font-bold text-emerald-700">🔴 Alert broadcast to Principal, Parent & Responder</p>
            <p className="text-[9px] text-emerald-600">No countdown — tracking begins immediately below.</p>
          </div>
        )}

        {!state.connectivity && state.pendingQueue.length > 0 && (
          <div className="bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 mb-2">
            <p className="text-[11px] font-bold text-slate-700 flex items-center gap-1"><WifiOff size={12} /> Not sent · No connection</p>
            <p className="text-[9.5px] text-slate-600 mt-0.5">Use the school's emergency steps now (alarm, PA system, runner, landline). {state.pendingQueue.length} report(s) queued and will auto-send once reconnected.</p>
          </div>
        )}

        {step === 1 && (
          <div>
            <p className="text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Step 1 · Category</p>
            <CategoryGrid 
              onSelect={(cat, sub) => {
                setCategory(cat);
                setSubType(sub);
                setStep(2);
              }}
            />
          </div>
        )}

        {step === 2 && category && subType && (
          <div>
            <p className="text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Step 2 · Who's affected</p>
            <p className="text-[10.5px] text-slate-500 mb-2">{category.label} → {subType.label}</p>
            <PopulationToggle 
              onSelect={(pop) => {
                setPopulation(pop);
                setStep(3);
              }}
            />
            <button onClick={() => setStep(1)} className="text-[10px] text-slate-400 mt-2 font-semibold">← Back</button>
          </div>
        )}

        {step === 3 && category && subType && population && (
          <div>
            <p className="text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Step 3 · Confirm & Submit</p>
            <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-1 mb-2">
              <p className="text-[12px] font-bold text-slate-800">{category.label} — {subType.label}</p>
              <p className="text-[10.5px] text-slate-500">{population.label}</p>
              <p className="text-[10.5px] text-slate-500">📍 {mismatch ? mismatch.label : room}</p>
            </div>
            <button onClick={handleStartSubmit} className="w-full bg-red-600 text-white rounded-xl py-3 text-[13.5px] font-extrabold tracking-wide">
              🔴 SUBMIT EMERGENCY ALERT
            </button>
            <button onClick={() => setStep(2)} className="text-[10px] text-slate-400 mt-2 font-semibold">← Back</button>
          </div>
        )}

        {myLastIncident && step === 1 && (
          <div className="bg-white border border-slate-200 rounded-xl p-2.5 mt-2.5">
            <p className="text-[9.5px] font-bold text-slate-500 mb-1 uppercase tracking-wide">Your Last Report</p>
            <WaitingLine status={myLastIncident.status} />
            <div className="mt-2"><ResponseTracker status={myLastIncident.status} compact /></div>
          </div>
        )}
      </div>

      {countdown !== null && (
        <Modal title="Broadcasting Alert" onClose={() => setCountdown(null)}>
          <div className="py-6 text-center space-y-4">
            <div className="text-6xl font-black text-red-600 animate-pulse">{countdown}</div>
            <p className="text-[12px] text-slate-600">Sending emergency alert to Principal and Responders...</p>
            <button onClick={() => { executeSubmit(); setCountdown(null); }} className="w-full bg-red-600 text-white rounded-lg py-2.5 text-[12.5px] font-bold">
              Send Immediately
            </button>
            <button onClick={() => setCountdown(null)} className="w-full bg-slate-100 text-slate-700 rounded-lg py-2.5 text-[12.5px] font-bold">
              Cancel False Alarm
            </button>
          </div>
        </Modal>
      )}

      {showLocationMismatch && (
        <Modal title="Confirm Your Location" onClose={() => setShowLocationMismatch(false)}>
          <p className="text-[11.5px] text-slate-600 mb-3">Your GPS doesn't match your saved room. Please confirm where you actually are.</p>
          <div className="space-y-1.5">
            {NON_CLASSROOM_AREAS.map((a) => (
              <button
                key={a.id}
                onClick={() => setMismatch(a)}
                className={`w-full text-left px-3 py-2 rounded-lg border text-[12px] font-semibold ${mismatch?.id === a.id ? "border-red-500 bg-red-50 text-red-700" : "border-slate-200 text-slate-700"}`}
              >{a.label}</button>
            ))}
          </div>
          <button
            disabled={!mismatch}
            onClick={() => setShowLocationMismatch(false)}
            className="w-full bg-red-600 disabled:bg-slate-300 text-white rounded-lg py-2.5 text-[12.5px] font-bold mt-3"
          >Confirm Location</button>
        </Modal>
      )}

      {showProfile && (
        <Modal title="Edit Profile / Room" onClose={() => setShowProfile(false)}>
          <div className="space-y-3">
            <div>
              <label className="text-[9.5px] font-semibold text-slate-500">Name</label>
              <input value={profileName} onChange={(e) => setProfileName(e.target.value)} className="w-full mt-0.5 border border-slate-200 rounded-lg px-2.5 py-2 text-[12.5px] outline-none focus:border-red-400" />
            </div>
            <div>
              <label className="text-[9.5px] font-semibold text-slate-500">Grade / Section</label>
              <input value={profileSection} onChange={(e) => setProfileSection(e.target.value)} className="w-full mt-0.5 border border-slate-200 rounded-lg px-2.5 py-2 text-[12.5px] outline-none focus:border-red-400" />
            </div>
            <div>
              <label className="text-[9.5px] font-semibold text-slate-500">Default Room</label>
              <input value={profileRoom} onChange={(e) => setProfileRoom(e.target.value)} className="w-full mt-0.5 border border-slate-200 rounded-lg px-2.5 py-2 text-[12.5px] outline-none focus:border-red-400" />
            </div>
            <button onClick={handleSaveProfile} className="w-full bg-red-600 text-white rounded-lg py-2.5 text-[12.5px] font-bold mt-1">
              Save Changes
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}