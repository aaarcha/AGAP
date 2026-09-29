import { useApp } from '@/context/AppContext';
import { SubmitFlow } from '@/components/reporting/SubmitFlow';
import Layout from '@/components/Layout';
import { Redirect } from 'wouter';
import { useEffect } from 'react';
import { toast } from 'sonner';

export default function TeacherPage() {
  const { state, dispatch } = useApp();

  // Auto Connectivity Flush Effect
  useEffect(() => {
    if (state.connectivity && state.pendingQueue.length > 0) {
      dispatch({ type: 'FLUSH_PENDING' });
      toast.success(`${state.pendingQueue.length} pending report(s) sent automatically.`);
    }
  }, [state.connectivity, state.pendingQueue.length, dispatch]);

  // Auto Seen Effect
  useEffect(() => {
    const openIncidents = state.incidents.filter(i => i.status === 'open');
    if (openIncidents.length === 0) return;
    const t = setTimeout(() => {
      openIncidents.forEach(i => {
        dispatch({ type: 'UPDATE_INCIDENT_STATUS', payload: { id: i.id, status: 'acknowledged' } });
      });
    }, 2200);
    return () => clearTimeout(t);
  }, [state.incidents, dispatch]);

  if (!state.currentUser || state.currentUser.role !== 'teacher') {
    return <Redirect to="/login" />;
  }

  return (
    <Layout>
      <SubmitFlow />
    </Layout>
  );
}