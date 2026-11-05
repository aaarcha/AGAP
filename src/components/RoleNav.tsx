import { BottomNav, SideNav, type NavTab } from "./Chrome";
import {
  ADMIN_TABS,
  PARENT_TABS,
  PRINCIPAL_TABS,
  RESPONDER_TABS,
  TEACHER_TABS,
  type AdminTab,
  type ParentTab,
  type PrincipalTab,
  type ResponderTab,
  type TeacherTab,
} from "../lib/navigation";

type RailProps<T extends string> = {
  tab: T;
  setTab: (t: T) => void;
  tabs: NavTab<T>[];
  subtitle: string;
};

/** Exactly one rail (and its phone equivalent) for the signed-in role. */
function Rail<T extends string>({ tab, setTab, tabs, subtitle }: RailProps<T>) {
  return (
    <>
      <SideNav tab={tab} setTab={setTab} tabs={tabs} subtitle={subtitle} />
      <BottomNav tab={tab} setTab={setTab} tabs={tabs} />
    </>
  );
}

type RoleProps<T extends string> = { tab: T; setTab: (t: T) => void };

/** The teacher rail carries the live pending-headcount count on its Headcount tab. */
export type TeacherNavExtras = { pendingHeadcount?: number };

export type RoleNavProps =
  | ({ role: "teacher" } & RoleProps<TeacherTab> & TeacherNavExtras)
  | ({ role: "parent" } & RoleProps<ParentTab>)
  | ({ role: "principal" } & RoleProps<PrincipalTab>)
  | ({ role: "responder" } & RoleProps<ResponderTab>)
  | ({ role: "super_admin" } & RoleProps<AdminTab>);

export function RoleNav(props: RoleNavProps) {
  switch (props.role) {
    case "teacher": {
      const tabs = TEACHER_TABS.map((t) =>
        t.id === "headcount" ? { ...t, badge: props.pendingHeadcount ?? 0 } : t,
      );
      return <Rail tab={props.tab} setTab={props.setTab} tabs={tabs} subtitle="Teacher" />;
    }
    case "parent":
      return <Rail tab={props.tab} setTab={props.setTab} tabs={PARENT_TABS} subtitle="Parent/PTA" />;
    case "principal":
      return <Rail tab={props.tab} setTab={props.setTab} tabs={PRINCIPAL_TABS} subtitle="Principal" />;
    case "responder":
      return <Rail tab={props.tab} setTab={props.setTab} tabs={RESPONDER_TABS} subtitle="Responder" />;
    case "super_admin":
      return <Rail tab={props.tab} setTab={props.setTab} tabs={ADMIN_TABS} subtitle="Super Admin" />;
  }
}
