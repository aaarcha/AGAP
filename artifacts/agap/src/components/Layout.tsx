import { ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useApp } from '@/context/AppContext';
import { Header } from './Header';
import { Footer } from './Footer';

interface LayoutProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  bottomNav?: ReactNode;
  hideFooter?: boolean;
}

export default function Layout({ children, title, subtitle, onBack, bottomNav, hideFooter }: LayoutProps) {
  const { state, dispatch } = useApp();
  const [, setLocation] = useLocation();

  const handleLogout = () => {
    dispatch({ type: 'LOGOUT' });
    setLocation('/login');
  };

  const defaultTitle = state.currentUser ? state.currentUser.name : "AGAP";
  const defaultSubtitle = state.currentUser ? `${state.currentUser.role.toUpperCase()} • ${state.currentUser.section || 'Sinalhan ES'}` : "Sinalhan ES • ID 108484";

  return (
    <div className="flex-1 flex flex-col overflow-hidden w-full h-full relative">
      <Header 
        title={title || defaultTitle} 
        subtitle={subtitle || defaultSubtitle} 
        onBack={onBack} 
        onLogout={state.currentUser ? handleLogout : undefined} 
      />
      <div className="flex-1 overflow-y-auto flex flex-col relative">
        {children}
      </div>
      {bottomNav}
      {!hideFooter && <Footer />}
    </div>
  );
}