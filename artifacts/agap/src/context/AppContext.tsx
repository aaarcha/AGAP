import React, { createContext, useContext, useReducer, ReactNode, useEffect } from 'react';
import { Incident, TeacherProfile, DemoUser, SEED_TEACHERS, SEED_INCIDENTS } from '@/lib/seedData';
import { computeUrgencyScore, getUrgencyBand } from '@/lib/urgency';

interface AppState {
  incidents: Incident[];
  teacherRoster: TeacherProfile[];
  currentUser: DemoUser | null;
  connectivity: boolean;
  pendingQueue: Incident[];
}

type Action =
  | { type: 'LOGIN'; payload: DemoUser }
  | { type: 'LOGOUT' }
  | { type: 'SET_CONNECTIVITY'; payload: boolean }
  | { type: 'ADD_INCIDENT'; payload: Omit<Incident, 'id' | 'timestamp' | 'elapsedMinutes'> }
  | { type: 'MERGE_INCIDENT'; payload: { id: string } }
  | { type: 'UPDATE_INCIDENT_STATUS'; payload: { id: string; status: Incident['status']; acknowledgedBy?: string } }
  | { type: 'UPDATE_TEACHER_PROFILE'; payload: Partial<TeacherProfile> & { id: string } }
  | { type: 'ADD_TEACHER'; payload: TeacherProfile }
  | { type: 'DELETE_TEACHER'; payload: string }
  | { type: 'FLUSH_PENDING' }
  | { type: 'TICK_TIME' };

const initialState: AppState = {
  incidents: SEED_INCIDENTS,
  teacherRoster: SEED_TEACHERS,
  currentUser: null,
  connectivity: true,
  pendingQueue: [],
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'LOGIN':
      return { ...state, currentUser: action.payload };
    case 'LOGOUT':
      return { ...state, currentUser: null };
    case 'SET_CONNECTIVITY':
      return { ...state, connectivity: action.payload };
    case 'ADD_INCIDENT': {
      const now = new Date();
      const newIncident: Incident = {
        ...action.payload,
        id: `inc-${Date.now()}`,
        timestamp: now,
        elapsedMinutes: 0,
      };
      
      if (!state.connectivity) {
        return {
          ...state,
          pendingQueue: [...state.pendingQueue, { ...newIncident, isPending: true }]
        };
      }
      
      return { ...state, incidents: [newIncident, ...state.incidents] };
    }
    case 'MERGE_INCIDENT':
      return {
        ...state,
        incidents: state.incidents.map(i => 
          i.id === action.payload.id ? { ...i, confirmedByCount: i.confirmedByCount + 1 } : i
        )
      };
    case 'UPDATE_INCIDENT_STATUS':
      return {
        ...state,
        incidents: state.incidents.map(i => 
          i.id === action.payload.id ? { 
            ...i, 
            status: action.payload.status,
            acknowledgedBy: action.payload.acknowledgedBy || i.acknowledgedBy,
            urgencyBand: getUrgencyBand(i.urgencyScore, action.payload.status)
          } : i
        )
      };
    case 'UPDATE_TEACHER_PROFILE':
      return {
        ...state,
        teacherRoster: state.teacherRoster.map(t => 
          t.id === action.payload.id ? { ...t, ...action.payload } : t
        ),
        currentUser: state.currentUser?.id === action.payload.id 
          ? { ...state.currentUser, ...action.payload } 
          : state.currentUser
      };
    case 'ADD_TEACHER':
      return { ...state, teacherRoster: [...state.teacherRoster, action.payload] };
    case 'DELETE_TEACHER':
      return { ...state, teacherRoster: state.teacherRoster.filter(t => t.id !== action.payload) };
    case 'FLUSH_PENDING':
      if (state.pendingQueue.length === 0) return state;
      const flushed = state.pendingQueue.map(i => ({ ...i, isPending: false }));
      return {
        ...state,
        pendingQueue: [],
        incidents: [...flushed, ...state.incidents]
      };
    case 'TICK_TIME':
      const now = new Date();
      return {
        ...state,
        incidents: state.incidents.map(i => {
          const diffMs = now.getTime() - i.timestamp.getTime();
          const elapsedMins = Math.floor(diffMs / 60000);
          return { ...i, elapsedMinutes: elapsedMins };
        }),
        pendingQueue: state.pendingQueue.map(i => {
          const diffMs = now.getTime() - i.timestamp.getTime();
          const elapsedMins = Math.floor(diffMs / 60000);
          return { ...i, elapsedMinutes: elapsedMins };
        })
      };
    default:
      return state;
  }
}

const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<Action>;
} | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Time tick effect to update elapsedMinutes
  useEffect(() => {
    const interval = setInterval(() => {
      dispatch({ type: 'TICK_TIME' });
    }, 60000); // every minute
    return () => clearInterval(interval);
  }, []);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
