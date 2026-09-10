import React from 'react';
import ComplianceCheckout from './checkout';
import ProjectForm from './project-form';
import { createRoot } from 'react-dom/client';
import './style.css';
function App() {
  const [saved, setSaved] = React.useState(false);
  if (location.pathname === '/checkout') return <ComplianceCheckout />;
  if (location.pathname === '/scenarios') return <main><h1>Create project</h1><ProjectForm /></main>;
  return <main><h1>{location.pathname === '/settings' ? 'Project settings' : 'Projects'}</h1><nav aria-label="Main"><a href="/">Projects</a> <a href="/settings">Settings</a></nav><form onSubmit={event => { event.preventDefault(); setSaved(true); }}><label htmlFor="name">Project name</label><input id="name" defaultValue="Launch" /><button type="submit">Save project</button><p role="status">{saved ? 'Saved' : ''}</p></form></main>;
}
createRoot(document.getElementById('root')).render(<App />);
