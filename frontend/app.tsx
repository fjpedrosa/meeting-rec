import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';

import { MeetingsPage } from './pages/meetings-page';
import { MeetingDetailPage } from './pages/meeting-detail-page';
import { ProfilesPage } from './pages/profiles-page';
import { UnknownSpeakersPage } from './pages/unknown-speakers-page';
import { ProcessingProgressContext, useProcessingProgressProvider } from './hooks/use-processing-progress';
import { ProcessingWidgetContainer } from './containers/processing-widget-container';

// Route matching
interface RouteMatch {
  page: string;
  params: Record<string, string>;
}

const parseRoute = (hash: string): RouteMatch => {
  const path = hash.replace(/^#/, '') || '/';

  // Match /meetings/:id
  const meetingDetailMatch = path.match(/^\/meetings\/(\d+)$/);
  if (meetingDetailMatch) {
    return { page: 'meeting-detail', params: { id: meetingDetailMatch[1] } };
  }

  // Match /profiles
  if (path === '/profiles') {
    return { page: 'profiles', params: {} };
  }

  // Match /unknown
  if (path === '/unknown') {
    return { page: 'unknown', params: {} };
  }

  // Default to meetings list
  return { page: 'meetings', params: {} };
};

// Navigation component
interface NavProps {
  currentPage: string;
  onNavigate: (hash: string) => void;
}

const Nav: React.FC<NavProps> = ({ currentPage, onNavigate }) => {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, hash: string) => {
    e.preventDefault();
    onNavigate(hash);
  };

  const isActive = (page: string) => currentPage === page;

  return (
    <nav className="nav">
      <div className="nav-content">
        <a
          href="#/"
          className="nav-logo"
          onClick={(e) => handleClick(e, '#/')}
        >
          Meeting Transcriber
        </a>
        <div className="nav-links">
          <a
            href="#/"
            className={`nav-link ${isActive('meetings') || isActive('meeting-detail') ? 'active' : ''}`}
            onClick={(e) => handleClick(e, '#/')}
          >
            Meetings
          </a>
          <a
            href="#/profiles"
            className={`nav-link ${isActive('profiles') ? 'active' : ''}`}
            onClick={(e) => handleClick(e, '#/profiles')}
          >
            Profiles
          </a>
          <a
            href="#/unknown"
            className={`nav-link ${isActive('unknown') ? 'active' : ''}`}
            onClick={(e) => handleClick(e, '#/unknown')}
          >
            Unknown Speakers
          </a>
        </div>
      </div>
    </nav>
  );
};

// Main App component
const App: React.FC = () => {
  const [route, setRoute] = useState(window.location.hash || '#/');
  const processingProgress = useProcessingProgressProvider();

  useEffect(() => {
    const handleHashChange = () => {
      setRoute(window.location.hash || '#/');
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigate = (hash: string) => {
    window.location.hash = hash;
  };

  const routeMatch = parseRoute(route);

  const renderPage = () => {
    switch (routeMatch.page) {
      case 'meeting-detail':
        return (
          <MeetingDetailPage
            meetingId={parseInt(routeMatch.params.id, 10)}
            onNavigate={navigate}
          />
        );
      case 'profiles':
        return <ProfilesPage onNavigate={navigate} />;
      case 'unknown':
        return <UnknownSpeakersPage onNavigate={navigate} />;
      case 'meetings':
      default:
        return <MeetingsPage onNavigate={navigate} />;
    }
  };

  return (
    <ProcessingProgressContext.Provider value={processingProgress}>
      <div className="app">
        <Nav currentPage={routeMatch.page} onNavigate={navigate} />
        <main className="main">{renderPage()}</main>
        <ProcessingWidgetContainer />
      </div>
    </ProcessingProgressContext.Provider>
  );
};

// Mount the app
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}

export default App;
