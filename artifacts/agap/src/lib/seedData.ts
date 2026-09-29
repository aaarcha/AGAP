export interface TeacherProfile {
  id: string;
  name: string;
  role: 'teacher' | 'principal' | 'parent' | 'responder';
  section: string;
  defaultRoom: string;
  building: string;
  floor: string;
  gpsCoords: string;
  status: 'active' | 'inactive';
  linkedPupil?: string; // for parent
}

export interface Incident {
  id: string;
  category: 'fire' | 'medical' | 'flooding' | 'security' | 'other';
  subType: string;
  severity: number;
  vulnerability: number;
  locationRisk: number;
  timeSensitivity: number;
  urgencyScore: number;
  urgencyBand: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'RESOLVED';
  location: string;
  reporterId: string;
  reporterName: string;
  timestamp: Date;
  elapsedMinutes: number;
  status: 'open' | 'acknowledged' | 'en_route' | 'on_site' | 'resolved';
  acknowledgedBy?: string;
  confirmedByCount: number;
  isPending?: boolean;
  affectedPopulation: 'individual' | 'classroom' | 'school';
  linkedSection?: string;
}

export interface DemoUser extends TeacherProfile {
  accountLabel: string;
}

export const DEMO_USERS: DemoUser[] = [
  {
    id: 't1',
    name: 'Ms. Ana Reyes',
    role: 'teacher',
    section: 'Grade 3 - Section A',
    defaultRoom: 'Rm 201',
    building: 'Bldg A',
    floor: 'Flr 2',
    gpsCoords: '14.312, 121.115',
    status: 'active',
    accountLabel: 'teacher@sinalhanes.deped.ph'
  },
  {
    id: 'p1',
    name: 'Dr. Maria Santos',
    role: 'principal',
    section: 'Admin',
    defaultRoom: 'Principal Office',
    building: 'Admin Bldg',
    floor: 'Flr 1',
    gpsCoords: '14.312, 121.115',
    status: 'active',
    accountLabel: 'principal@sinalhanes.deped.ph'
  },
  {
    id: 'pa1',
    name: 'Mr. Jose Cruz',
    role: 'parent',
    section: 'Grade 3 - Section A',
    defaultRoom: 'N/A',
    building: 'N/A',
    floor: 'N/A',
    gpsCoords: '',
    status: 'active',
    linkedPupil: 'Juan Cruz',
    accountLabel: 'parent@sinalhanes.pta.ph'
  },
  {
    id: 'r1',
    name: 'Ofc. Bong Dela Cruz',
    role: 'responder',
    section: 'CDRRMO',
    defaultRoom: 'N/A',
    building: 'Barangay Hall',
    floor: 'N/A',
    gpsCoords: '',
    status: 'active',
    accountLabel: 'responder@barangaysinalhan.gov.ph'
  }
];

export const SEED_TEACHERS: TeacherProfile[] = [
  DEMO_USERS[0],
  {
    id: 't2',
    name: 'Mr. Jose Manalac',
    role: 'teacher',
    section: 'Grade 4 - Section B',
    defaultRoom: 'Rm 301',
    building: 'Bldg B',
    floor: 'Flr 3',
    gpsCoords: '14.312, 121.115',
    status: 'active'
  },
  {
    id: 't3',
    name: 'Ms. Carla Vidal',
    role: 'teacher',
    section: 'Grade 5 - Section A',
    defaultRoom: 'Rm 401',
    building: 'Bldg A',
    floor: 'Flr 4',
    gpsCoords: '14.312, 121.115',
    status: 'active'
  },
  {
    id: 't4',
    name: 'Mr. Ramon Santos',
    role: 'teacher',
    section: 'Grade 2 - Section C',
    defaultRoom: 'Rm 101',
    building: 'Bldg C',
    floor: 'Flr 1',
    gpsCoords: '14.312, 121.115',
    status: 'active'
  },
  {
    id: 't5',
    name: 'Ms. Ligaya Dela Cruz',
    role: 'teacher',
    section: 'Grade 6 - Section B',
    defaultRoom: 'Rm 305',
    building: 'Bldg B',
    floor: 'Flr 3',
    gpsCoords: '14.312, 121.115',
    status: 'inactive'
  }
];

export const SEED_INCIDENTS: Incident[] = [
  {
    id: 'inc1',
    category: 'medical',
    subType: 'Heatstroke',
    severity: 3,
    vulnerability: 4,
    locationRisk: 3,
    timeSensitivity: 4,
    urgencyScore: 3.39,
    urgencyBand: 'HIGH',
    location: 'Rm 201 Bldg A Flr 2',
    reporterId: 't1',
    reporterName: 'Ms. Ana Reyes',
    timestamp: new Date(Date.now() - 5 * 60000), // 5 mins ago
    elapsedMinutes: 5,
    status: 'acknowledged',
    confirmedByCount: 2,
    affectedPopulation: 'individual',
    linkedSection: 'Grade 3 - Section A'
  },
  {
    id: 'inc2',
    category: 'fire',
    subType: 'Electrical Short',
    severity: 4,
    vulnerability: 4,
    locationRisk: 3,
    timeSensitivity: 5,
    urgencyScore: 3.99,
    urgencyBand: 'HIGH',
    location: 'Rm 301 Bldg B Flr 3',
    reporterId: 't2',
    reporterName: 'Mr. Jose Manalac',
    timestamp: new Date(Date.now() - 2 * 60000), // 2 mins ago
    elapsedMinutes: 2,
    status: 'open',
    confirmedByCount: 1,
    affectedPopulation: 'classroom',
    linkedSection: 'Grade 4 - Section B'
  }
];
