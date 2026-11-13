import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowUpRight,
  Bell,
  BookOpen,
  Bookmark,
  Check,
  CheckCircle,
  ChevronDown,
  Clock3,
  Download,
  FileQuestion,
  FileText,
  Filter,
  FlaskConical,
  HelpCircle,
  History,
  LayoutGrid,
  Library,
  LogOut,
  Menu,
  MessageCircle,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Upload,
  User,
  Users,
  X
} from 'lucide-react';
import './style.css';
import './extended.css';
import AuthScreen from './AuthScreen.jsx';

const api = async (url, options = {}) => {
  const r = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {})
    }
  });
  let data = {};
  try {
    data = await r.json();
  } catch {}
  if (!r.ok) {
    throw Object.assign(new Error(data.error || `Request failed (${r.status})`), { status: r.status, data });
  }
  return data;
};

const icons = {
  Notes: FileText,
  Video: Play,
  'Question paper': FileQuestion,
  Slides: LayoutGrid,
  'Lab material': FlaskConical,
  Reference: BookOpen,
  Assignment: FileText
};

const cats = [
  ['All resources', Library],
  ['Notes', FileText],
  ['Video', Play],
  ['Question paper', FileQuestion],
  ['Lab material', FlaskConical]
];

const dateLabel = (v) => {
  const d = new Date(String(v || '').replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '';
  const h = (Date.now() - d.getTime()) / 3600000;
  return h < 24 ? `${Math.max(1, Math.floor(h))}h ago` : h < 48 ? 'Yesterday' : `${Math.floor(h / 24)}d ago`;
};

function Marked({ text, query }) {
  if (!query) return text;
  const terms = query
    .split(/\s+/)
    .filter((t) => t.length > 1 && !['and', 'or', 'not'].includes(t.toLowerCase()))
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!terms.length) return text;
  const re = new RegExp(`(${terms.join('|')})`, 'giu');
  return String(text || '')
    .split(re)
    .map((s, i) => (terms.some((t) => s.toLowerCase() === t.toLowerCase()) ? <mark key={i}>{s}</mark> : s));
}

function App() {
  const [user, setUser] = useState(null);
  const [boot, setBoot] = useState(true);
  const [notice, setNotice] = useState('');
  const [toastTimer, setToastTimer] = useState(null);

  // Top level views: 'library' | 'queries' | 'chat' | 'admin'
  const [mainNav, setMainNav] = useState('library');

  // Library & Search state
  const [resources, setResources] = useState([]);
  const [courses, setCourses] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [category, setCategory] = useState('All resources');
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [filters, setFilters] = useState({
    departmentId: '',
    courseId: '',
    semester: '',
    unitId: '',
    type: '',
    from: '',
    to: ''
  });
  const [filterOpen, setFilterOpen] = useState(false);
  const [sort, setSort] = useState('relevance');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [mode, setMode] = useState('browse'); // 'browse' | 'recent' | 'top' | 'search' | 'saved' | 'my-uploads'

  // Queries state
  const [queriesList, setQueriesList] = useState([]);
  const [queryTab, setQueryTab] = useState('all'); // 'all' | 'pending' | 'answered'
  const [replyTextMap, setReplyTextMap] = useState({});
  const [newQueryTopic, setNewQueryTopic] = useState('');
  const [newQueryQuestion, setNewQueryQuestion] = useState('');
  const [newQueryCourseId, setNewQueryCourseId] = useState('');
  const [newQueryResourceId, setNewQueryResourceId] = useState(null);

  // Chat state
  const [chatContacts, setChatContacts] = useState([]);
  const [activeContact, setActiveContact] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSearch, setChatSearch] = useState('');

  // Admin Hub state
  const [adminTab, setAdminTab] = useState('departments'); // 'departments' | 'courses' | 'users' | 'resources' | 'reports' | 'audit' | 'backup'
  const [adminData, setAdminData] = useState({ reports: [], audit: [], users: [], resources: [], backups: [] });

  // Common modals & details
  const [mobile, setMobile] = useState(false);
  const [modal, setModal] = useState(''); // 'resource' | 'upload' | 'profile' | 'notifications' | 'history' | 'askQuery' | 'report'
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [versions, setVersions] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [history, setHistory] = useState([]);
  const [reportReason, setReportReason] = useState('incorrect');
  const [uploadTarget, setUploadTarget] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [profile, setProfile] = useState({});
  const [pref, setPref] = useState({});

  const toast = useCallback(
    (t) => {
      setNotice(t);
      if (toastTimer) clearTimeout(toastTimer);
      const tm = setTimeout(() => setNotice(''), 3000);
      setToastTimer(tm);
    },
    [toastTimer]
  );

  const loadCoursesAndDepts = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([api('/api/departments'), api('/api/courses')]);
      setDepartments(d.items || []);
      setCourses(c.items || []);
    } catch {}
  }, []);

  const loadBrowse = useCallback(
    async (which = 'browse', p = 1) => {
      try {
        let path = `/api/resources?page=${p}&limit=6`;
        if (which === 'recent') path = '/api/resources/recent';
        else if (which === 'top') path = '/api/resources/top-rated';
        const d = await api(path);
        setResources(d.items || []);
        setTotal(d.total || 0);
        setPage(d.page || p);
        setPages(d.pages || 1);
        setMode(which);
      } catch (e) {
        toast(e.message);
      }
    },
    [toast]
  );

  const submitSearch = useCallback(
    async (p = 1, overrides = {}) => {
      const next = { ...filters, ...overrides };
      const params = new URLSearchParams({ page: String(p), limit: '6', sort });
      if (query.trim()) params.set('q', query.trim());
      for (const [k, v] of Object.entries(next)) if (v) params.set(k, v);
      if (category !== 'All resources' && !next.type) {
        const t = category === 'Notes' ? 'Notes' : category;
        params.set('type', t);
      }
      try {
        const d = await api(`/api/search?${params}`);
        setResources(d.items || []);
        setTotal(d.total || 0);
        setPage(d.page || 1);
        setPages(Math.max(1, d.pages || 1));
        setActiveQuery(query.trim());
        setMode('search');
        setMainNav('library');
        setSuggestions([]);
      } catch (e) {
        toast(e.message);
      }
    },
    [filters, query, sort, category, toast]
  );

  const refreshNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const d = await api('/api/notifications');
      setNotifications(d.items || []);
      setUnread(d.unread || 0);
    } catch {}
  }, [user]);

  // Load Queries
  const loadQueries = useCallback(async () => {
    try {
      const d = await api('/api/queries');
      setQueriesList(d.items || []);
    } catch (e) {
      toast(e.message);
    }
  }, [toast]);

  // Load Chat Contacts
  const loadChatContacts = useCallback(async () => {
    try {
      const d = await api('/api/chat/contacts');
      setChatContacts(d.items || []);
      if (!activeContact && d.items?.length > 0) {
        setActiveContact(d.items[0]);
      }
    } catch {}
  }, [activeContact]);

  // Load Chat Messages for selected contact
  const loadChatMessages = useCallback(
    async (partnerId) => {
      if (!partnerId) return;
      try {
        const d = await api(`/api/chat/messages/${partnerId}`);
        setChatMessages(d.items || []);
      } catch {}
    },
    []
  );

  // Polling for Chat & Notifications
  useEffect(() => {
    if (!user) return;
    refreshNotifications();
    const t = setInterval(() => {
      refreshNotifications();
      if (mainNav === 'chat' && activeContact?.id) {
        loadChatMessages(activeContact.id);
        loadChatContacts();
      }
    }, 4000);
    return () => clearInterval(t);
  }, [user, mainNav, activeContact, refreshNotifications, loadChatMessages, loadChatContacts]);

  useEffect(() => {
    api('/api/auth/me')
      .then((d) => {
        setUser(d.user);
        if (d.user.role === 'Admin') setMainNav('admin');
      })
      .catch(() => {})
      .finally(() => setBoot(false));
    loadCoursesAndDepts();
  }, [loadCoursesAndDepts]);

  useEffect(() => {
    if (!user) return;
    loadBrowse('browse');
    loadQueries();
    loadChatContacts();
    api('/api/users/me').then((d) => setProfile(d.user));
    api('/api/notification-preferences').then((d) => setPref(d.preferences));
  }, [user, loadBrowse, loadQueries, loadChatContacts]);

  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(
      () =>
        api(`/api/search/suggestions?q=${encodeURIComponent(query)}`)
          .then((d) => setSuggestions(d.items || []))
          .catch(() => {}),
      200
    );
    return () => clearTimeout(timer);
  }, [query]);

  // Load chat messages when activeContact changes
  useEffect(() => {
    if (activeContact?.id && mainNav === 'chat') {
      loadChatMessages(activeContact.id);
    }
  }, [activeContact, mainNav, loadChatMessages]);

  const login = async (email, password) => {
    const d = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    setUser(d.user);
    if (d.user.role === 'Admin') setMainNav('admin');
    else setMainNav('library');
    toast(`Welcome, ${d.user.name}`);
  };

  const register = async (payload) => {
    const d = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) });
    setUser(d.user);
    setMainNav('library');
    toast(`Account created for ${d.user.name}`);
  };

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setResources([]);
    setModal('');
    setMainNav('library');
    toast('You have signed out successfully');
  };

  const updateFilter = (key, value) => setFilters((s) => ({ ...s, [key]: value }));

  const openResource = async (r) => {
    setSelected(r);
    setDetail(r);
    setModal('resource');
    setVersions([]);
    try {
      const d = await api(`/api/resources/${r.id}`);
      setDetail(d.resource);
      setVersions(d.versions || []);
    } catch (e) {
      toast(e.message);
    }
  };

  const sendChatMessage = async (e) => {
    e.preventDefault();
    if (!activeContact?.id || !chatInput.trim()) return;
    const text = chatInput.trim();
    setChatInput('');
    try {
      const res = await api(`/api/chat/messages/${activeContact.id}`, {
        method: 'POST',
        body: JSON.stringify({ message: text })
      });
      setChatMessages((prev) => [...prev, { ...res, sender_name: user.name }]);
      loadChatContacts();
    } catch (e) {
      toast(e.message);
    }
  };

  const submitStudentQuery = async (e) => {
    e.preventDefault();
    if (!newQueryTopic.trim() || !newQueryQuestion.trim()) return;
    try {
      await api('/api/queries', {
        method: 'POST',
        body: JSON.stringify({
          topic: newQueryTopic.trim(),
          question: newQueryQuestion.trim(),
          course_id: newQueryCourseId ? Number(newQueryCourseId) : null,
          resource_id: newQueryResourceId
        })
      });
      setNewQueryTopic('');
      setNewQueryQuestion('');
      setNewQueryCourseId('');
      setNewQueryResourceId(null);
      setModal('');
      toast('Your query has been submitted to staff');
      await loadQueries();
      setMainNav('queries');
    } catch (e) {
      toast(e.message);
    }
  };

  const submitStaffReply = async (queryId) => {
    const reply = replyTextMap[queryId];
    if (!reply || !reply.trim()) {
      toast('Please write a reply before submitting');
      return;
    }
    try {
      await api(`/api/queries/${queryId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ reply: reply.trim() })
      });
      setReplyTextMap((prev) => ({ ...prev, [queryId]: '' }));
      toast('Reply sent to student');
      await loadQueries();
    } catch (e) {
      toast(e.message);
    }
  };

  const markRead = async (id) => {
    try {
      await api(`/api/notifications/${id}/read`, { method: 'PATCH', body: '{}' });
      refreshNotifications();
    } catch (e) {
      toast(e.message);
    }
  };

  const openAdminData = async () => {
    try {
      const [r, a, u, res, b] = await Promise.all([
        api('/api/admin/reports'),
        api('/api/admin/audit'),
        api('/api/admin/users'),
        api('/api/admin/resources'),
        api('/api/admin/backups')
      ]);
      setAdminData({
        reports: r.items || [],
        audit: a.items || [],
        users: u.items || [],
        resources: res.items || [],
        backups: b.items || []
      });
    } catch (e) {
      toast(e.message);
    }
  };

  useEffect(() => {
    if (mainNav === 'admin' && user?.role === 'Admin') {
      openAdminData();
    }
  }, [mainNav, user]);

  const openHistory = async () => {
    try {
      const d = await api('/api/search/history');
      setHistory(d.items || []);
      setModal('history');
    } catch (e) {
      toast(e.message);
    }
  };

  const submitUpload = async (e) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (uploadTarget?.id) {
      try {
        await api(`/api/resources/${uploadTarget.id}`, { method: 'PATCH', body: form });
        toast('Material updated successfully');
        setModal('');
        setUploadTarget(null);
        await loadBrowse('browse');
      } catch (x) {
        setUploadError(x.message);
      }
      return;
    }

    const send = async (force = false) => {
      if (force) form.set('confirm_duplicate', '1');
      return fetch('/api/resources', {
        method: 'POST',
        body: form,
        credentials: 'same-origin'
      }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Object.assign(new Error(d.error || 'Upload failed'), { status: r.status, data: d });
        return d;
      });
    };

    try {
      await send();
      toast('Material uploaded successfully');
      setModal('');
      setUploadTarget(null);
      await loadBrowse('browse');
    } catch (x) {
      if (x.status === 409 && x.data?.duplicate && window.confirm(`${x.message}: “${x.data.duplicate.title}”. Upload anyway?`)) {
        try {
          await send(true);
          toast('Material added');
          setModal('');
          setUploadTarget(null);
          await loadBrowse('browse');
        } catch (e2) {
          setUploadError(e2.message);
        }
      } else {
        setUploadError(x.message);
      }
    }
  };

  const report = async (e) => {
    e.preventDefault();
    try {
      await api(`/api/resources/${selected.id}/report`, {
        method: 'POST',
        body: JSON.stringify({ reason: reportReason, details: e.currentTarget.details.value })
      });
      toast('Thank you. The report was sent to administrators.');
      setModal('resource');
    } catch (x) {
      toast(x.message);
    }
  };

  const saveRating = async (value) => {
    try {
      const d = await api(`/api/resources/${selected.id}/rating`, {
        method: 'PUT',
        body: JSON.stringify({ value })
      });
      setDetail((s) => ({ ...s, average_rating: d.average_rating }));
      toast(`Your ${value}-star rating was saved`);
    } catch (e) {
      toast(e.message);
    }
  };

  const loadSaved = async () => {
    try {
      const d = await api('/api/resources/saved?page=1&limit=6');
      setResources(d.items || []);
      setTotal(d.total || 0);
      setPage(d.page || 1);
      setPages(d.pages || 1);
      setMode('saved');
      setMainNav('library');
    } catch (e) {
      toast(e.message);
    }
  };

  const visibleCourses = useMemo(
    () => courses.filter((c) => !filters.departmentId || String(c.department_id) === String(filters.departmentId)),
    [courses, filters.departmentId]
  );

  const pendingQueriesCount = useMemo(
    () => queriesList.filter((q) => q.status === 'pending').length,
    [queriesList]
  );

  const filteredQueries = useMemo(() => {
    if (queryTab === 'pending') return queriesList.filter((q) => q.status === 'pending');
    if (queryTab === 'answered') return queriesList.filter((q) => q.status === 'answered');
    return queriesList;
  }, [queriesList, queryTab]);

  const filteredContacts = useMemo(() => {
    if (!chatSearch.trim()) return chatContacts;
    const term = chatSearch.toLowerCase();
    return chatContacts.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (c.department_name && c.department_name.toLowerCase().includes(term)) ||
        (c.department_code && c.department_code.toLowerCase().includes(term))
    );
  }, [chatContacts, chatSearch]);

  if (boot) return <div className="loading-screen">Opening CourseVault…</div>;
  if (!user) return <AuthScreen onLogin={login} onRegister={register} toast={toast} api={api} />;

  const isStaff = user.role === 'Staff';
  const isAdmin = user.role === 'Admin';
  const isStudent = user.role === 'Student';
  const firstName = user.name.split(' ')[0];

  // Professional, non-technical greetings tailored to each role
  const welcomeText = isStudent
    ? {
        kicker: 'STUDENT PORTAL',
        title: `Good morning, ${firstName}`,
        sub: 'Explore lecture notes, syllabus materials, question papers, and video lectures across your courses.'
      }
    : isStaff
    ? {
        kicker: 'FACULTY WORKSPACE',
        title: `Good morning, ${firstName}`,
        sub: 'Upload and manage course study materials, lecture notes, and question banks for your students.'
      }
    : {
        kicker: 'ADMINISTRATION CENTER',
        title: `Good morning, ${firstName}`,
        sub: 'Manage campus engineering departments, academic courses, user accounts, and library resources.'
      };

  const userDept = departments.find((d) => d.id === user.department_id);

  return (
    <div className="shell">
      {/* SIDEBAR NAVIGATION - STRICT ROLE SEPARATION */}
      <aside className={`sidebar ${mobile ? 'show' : ''}`}>
        <div className="brand">
          <i>
            <BookOpen size={20} />
          </i>
          course<span>vault</span>
          <button className="close" onClick={() => setMobile(false)} aria-label="Close menu">
            <X />
          </button>
        </div>

        {/* Workspace Tag */}
        <small className="label">YOUR WORKSPACE</small>
        <div className="department" style={{ cursor: 'default' }}>
          <b>{userDept?.code || (isAdmin ? 'ADM' : 'CV')}</b>
          <span>
            <strong>{userDept?.name || (isAdmin ? 'Campus Administration' : 'All Departments')}</strong>
            <small>
              {isStudent
                ? `Semester ${user.semester || '—'} · Engineering`
                : isStaff
                ? `Faculty Member · ${userDept?.code || 'Campus'}`
                : 'System Administrator'}
            </small>
          </span>
        </div>

        {/* ROLE SPECIFIC NAVIGATION */}
        {/* STUDENT ROLE MENU */}
        {isStudent && (
          <>
            <small className="label">STUDY LIBRARY</small>
            <nav>
              <button
                className={`nav ${mainNav === 'library' && mode !== 'saved' ? 'selected' : ''}`}
                onClick={() => {
                  setMainNav('library');
                  setCategory('All resources');
                  setMode('browse');
                  setMobile(false);
                  loadBrowse('browse');
                }}
              >
                <Library size={18} />
                <span>All Study Materials</span>
              </button>
              {cats.slice(1).map(([name, Icon]) => (
                <button
                  className={`nav ${mainNav === 'library' && category === name ? 'selected' : ''}`}
                  key={name}
                  onClick={() => {
                    setMainNav('library');
                    setCategory(name);
                    setMode('browse');
                    setFilters((s) => ({ ...s, type: name }));
                    setMobile(false);
                    loadBrowse('browse');
                  }}
                >
                  <Icon size={18} />
                  <span>{name === 'Notes' ? 'Lecture Notes' : name === 'Video' ? 'Video Lectures' : name === 'Question paper' ? 'Question Papers' : 'Lab Materials'}</span>
                </button>
              ))}
            </nav>

            <small className="label personal">ACADEMIC INTERACTION</small>
            <nav>
              <button
                className={`nav ${mainNav === 'queries' ? 'selected' : ''}`}
                onClick={() => {
                  setMainNav('queries');
                  loadQueries();
                  setMobile(false);
                }}
              >
                <HelpCircle size={18} />
                <span>My Queries</span>
              </button>
              <button
                className={`nav ${mainNav === 'chat' ? 'selected' : ''}`}
                onClick={() => {
                  setMainNav('chat');
                  loadChatContacts();
                  setMobile(false);
                }}
              >
                <MessageSquare size={18} />
                <span>Faculty Chat</span>
              </button>
              <button
                className={`nav ${mode === 'saved' && mainNav === 'library' ? 'selected' : ''}`}
                onClick={() => {
                  setMainNav('library');
                  loadSaved();
                  setMobile(false);
                }}
              >
                <Bookmark size={18} />
                <span>Saved Materials</span>
              </button>
              <button className="nav" onClick={openHistory}>
                <History size={18} />
                <span>Search History</span>
              </button>
            </nav>
          </>
        )}

        {/* STAFF ROLE MENU */}
        {isStaff && (
          <>
            <small className="label">FACULTY TOOLS</small>
            <nav>
              <button
                className={`nav ${mainNav === 'library' && mode !== 'my-uploads' ? 'selected' : ''}`}
                onClick={() => {
                  setMainNav('library');
                  setCategory('All resources');
                  setMode('browse');
                  setMobile(false);
                  loadBrowse('browse');
                }}
              >
                <Library size={18} />
                <span>Course Library</span>
              </button>
              <button
                className="nav"
                onClick={() => {
                  setUploadTarget(null);
                  setUploadError('');
                  setModal('upload');
                  setMobile(false);
                }}
              >
                <Upload size={18} />
                <span>Upload Study Material</span>
              </button>
              <button
                className={`nav ${mainNav === 'queries' ? 'selected' : ''}`}
                onClick={() => {
                  setMainNav('queries');
                  loadQueries();
                  setMobile(false);
                }}
              >
                <HelpCircle size={18} />
                <span>Student Queries</span>
                {pendingQueriesCount > 0 && <span className="chat-badge">{pendingQueriesCount}</span>}
              </button>
              <button
                className={`nav ${mainNav === 'chat' ? 'selected' : ''}`}
                onClick={() => {
                  setMainNav('chat');
                  loadChatContacts();
                  setMobile(false);
                }}
              >
                <MessageSquare size={18} />
                <span>Student Chat</span>
              </button>
            </nav>
          </>
        )}

        {/* ADMIN ROLE MENU */}
        {isAdmin && (
          <>
            <small className="label">ADMINISTRATION</small>
            <nav>
              <button
                className={`nav ${mainNav === 'admin' && adminTab === 'departments' ? 'selected' : ''}`}
                onClick={() => {
                  setMainNav('admin');
                  setAdminTab('departments');
                  setMobile(false);
                }}
              >
                <BuildingIcon size={18} />
                <span>Engineering Departments</span>
              </button>
              <button
                className={`nav ${mainNav === 'admin' && adminTab === 'courses' ? 'selected' : ''}`}
                onClick={() => {
                  setMainNav('admin');
                  setAdminTab('courses');
                  setMobile(false);
                }}
              >
                <BookOpen size={18} />
                <span>Manage Courses</span>
              </button>
              <button
                className={`nav ${mainNav === 'admin' && adminTab === 'users' ? 'selected' : ''}`}
                onClick={() => {
                  setMainNav('admin');
                  setAdminTab('users');
                  setMobile(false);
                }}
              >
                <Users size={18} />
                <span>User Accounts</span>
              </button>
              <button
                className={`nav ${mainNav === 'admin' && adminTab === 'resources' ? 'selected' : ''}`}
                onClick={() => {
                  setMainNav('admin');
                  setAdminTab('resources');
                  setMobile(false);
                }}
              >
                <ShieldAlert size={18} />
                <span>Resource Moderation</span>
              </button>
              <button
                className={`nav ${mainNav === 'admin' && adminTab === 'reports' ? 'selected' : ''}`}
                onClick={() => {
                  setMainNav('admin');
                  setAdminTab('reports');
                  setMobile(false);
                }}
              >
                <FileQuestion size={18} />
                <span>Student Reports</span>
              </button>
              <button
                className={`nav ${mainNav === 'library' ? 'selected' : ''}`}
                onClick={() => {
                  setMainNav('library');
                  loadBrowse('browse');
                  setMobile(false);
                }}
              >
                <Library size={18} />
                <span>View Library Catalog</span>
              </button>
            </nav>
          </>
        )}

        {/* Sidebar Footer */}
        <div className="sidebottom">
          <button className="profile" onClick={() => setModal('profile')}>
            <i>{user.name.split(' ').map((x) => x[0]).slice(0, 2).join('')}</i>
            <span>
              <b>{user.name}</b>
              <small>{user.role} Account</small>
            </span>
            <Settings size={17} />
          </button>
        </div>
      </aside>

      {mobile && <button className="scrim" onClick={() => setMobile(false)} aria-label="Close navigation" />}

      {/* MAIN VIEW CONTENT */}
      <main>
        <header>
          <button className="hamb" onClick={() => setMobile(true)} aria-label="Open menu">
            <Menu />
          </button>
          <div className="crumb">
            Campus Portal <span>/</span>{' '}
            <b>{mainNav === 'library' ? (mode === 'saved' ? 'Saved Materials' : 'Study Library') : mainNav === 'queries' ? 'Academic Queries' : mainNav === 'chat' ? 'Direct Messages' : 'Administration Hub'}</b>
          </div>
          <div className="headright">
            <button
              className="bell"
              aria-label="Notifications"
              onClick={async () => {
                await refreshNotifications();
                setModal('notifications');
              }}
            >
              <Bell />
              <i className={unread ? '' : 'read-dot'} />
              {unread > 0 && <span className="unread-count">{unread > 99 ? '99+' : unread}</span>}
            </button>
            <button className="user" onClick={() => setModal('profile')}>
              {user.name.split(' ').map((x) => x[0]).slice(0, 2).join('')}
            </button>
            <button className="logout" onClick={logout}>
              <LogOut size={15} /> <span>Sign out</span>
            </button>
          </div>
        </header>

        <section className="content">
          {/* TOP WELCOME BAR */}
          <div className="welcome">
            <div>
              <small className="eyebrow">
                <Sparkles size={13} /> {welcomeText.kicker}
              </small>
              <h1>
                {welcomeText.title} <em>✳</em>
              </h1>
              <p>{welcomeText.sub}</p>
            </div>
            {isStaff && (
              <button
                className="upload"
                onClick={() => {
                  setUploadTarget(null);
                  setUploadError('');
                  setModal('upload');
                }}
              >
                <Upload size={16} /> Upload Study Material
              </button>
            )}
            {isStudent && (
              <button
                className="upload"
                style={{ background: '#7161d6' }}
                onClick={() => {
                  setNewQueryTopic('');
                  setNewQueryQuestion('');
                  setNewQueryCourseId('');
                  setModal('askQuery');
                }}
              >
                <Plus size={16} /> Ask a Query
              </button>
            )}
          </div>

          {/* ========================================================
              VIEW 1: STUDY LIBRARY & TOPIC SEARCH
              ======================================================== */}
          {mainNav === 'library' && (
            <>
              {/* TOPIC SEARCH BAR */}
              <div className="searchbox">
                <div className="searchtitle">
                  <i>
                    <Search size={17} />
                  </i>
                  <span>
                    <b>Search Academic Resources</b>
                    <small>Search by topic, unit, subject or course</small>
                  </span>
                </div>
                <form
                  className="searchinput"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitSearch(1);
                  }}
                >
                  <Search size={18} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown' && suggestions.length) {
                        e.preventDefault();
                        setQuery(suggestions[0]);
                      }
                    }}
                    placeholder="Enter a topic, e.g. “process synchronization”, “thermodynamics”, “unit 3”…"
                    aria-label="Search CourseVault"
                  />
                  <button className="search-submit">Search</button>
                  {suggestions.length > 0 && (
                    <div className="suggestions">
                      {suggestions.map((s) => (
                        <button
                          type="button"
                          key={s}
                          onClick={() => {
                            setQuery(s);
                            setSuggestions([]);
                            setTimeout(() => submitSearch(1, { q: s }), 0);
                          }}
                        >
                          <Search size={13} />
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </form>
                <button className="filter" onClick={() => setFilterOpen((v) => !v)} aria-expanded={filterOpen}>
                  <SlidersHorizontal size={17} /> Filters
                </button>
              </div>

              {/* FILTER PANEL - SHOWS ALL 18 ENGINEERING DEPARTMENTS */}
              {filterOpen && (
                <div className="filter-panel">
                  <label>
                    Engineering Department
                    <select
                      value={filters.departmentId}
                      onChange={(e) => {
                        updateFilter('departmentId', e.target.value);
                        updateFilter('courseId', '');
                      }}
                    >
                      <option value="">All 18 Engineering Departments</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.code})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Course
                    <select value={filters.courseId} onChange={(e) => updateFilter('courseId', e.target.value)}>
                      <option value="">All Courses</option>
                      {visibleCourses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} · Sem {c.semester}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Semester
                    <select value={filters.semester} onChange={(e) => updateFilter('semester', e.target.value)}>
                      <option value="">Any Semester</option>
                      {Array.from({ length: 8 }, (_, i) => (
                        <option key={i + 1} value={i + 1}>
                          Semester {i + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Unit / Module
                    <input placeholder="e.g. Unit 3" value={filters.unitId} onChange={(e) => updateFilter('unitId', e.target.value)} />
                  </label>
                  <label>
                    Material Type
                    <select value={filters.type} onChange={(e) => updateFilter('type', e.target.value)}>
                      <option value="">Any Type</option>
                      {Object.keys(icons).map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <button className="primary" onClick={() => submitSearch(1)}>
                    Apply Filters
                  </button>
                  <button
                    className="linkbtn"
                    onClick={() => {
                      setFilters({ departmentId: '', courseId: '', semester: '', unitId: '', type: '', from: '', to: '' });
                      setCategory('All resources');
                    }}
                  >
                    Clear Filters
                  </button>
                </div>
              )}

              {/* STATS STRIP */}
              <div className="stats">
                <div>
                  <i className="purple">
                    <Library />
                  </i>
                  <span>
                    <b>{total.toLocaleString()}</b>
                    <small>Materials Available</small>
                  </span>
                </div>
                <hr />
                <div>
                  <i className="green">
                    <BookOpen />
                  </i>
                  <span>
                    <b>{departments.length}</b>
                    <small>Engineering Departments</small>
                  </span>
                </div>
                <hr />
                <div>
                  <i className="orange">
                    <Star />
                  </i>
                  <span>
                    <b>{courses.length}</b>
                    <small>Curriculum Courses</small>
                  </span>
                </div>
                <label className="role-pill">{user.role}</label>
              </div>

              {/* SECTION HEADER & SORT */}
              <div className="sectionhead">
                <div>
                  <small>{mode === 'search' ? 'SEARCH RESULTS' : 'COURSE MATERIALS'}</small>
                  <h2>{mode === 'saved' ? 'Saved Materials' : mode === 'search' ? `Results for “${activeQuery}”` : category}</h2>
                </div>
                <div className="head-controls">
                  <label className="sort-select">
                    Sort by
                    <select
                      value={sort}
                      onChange={(e) => {
                        setSort(e.target.value);
                        if (mode === 'search') setTimeout(() => submitSearch(1), 0);
                        else if (e.target.value === 'rating') loadBrowse('top');
                        else if (e.target.value === 'recent') loadBrowse('recent');
                      }}
                    >
                      <option value="relevance">Recommended</option>
                      <option value="recent">Recently Added</option>
                      <option value="rating">Highest Rated</option>
                    </select>
                  </label>
                </div>
              </div>

              {/* RESOURCE CARDS GRID */}
              {resources.length ? (
                <div className="grid">
                  {resources.map((r) => (
                    <ResourceCard
                      key={r.id}
                      resource={r}
                      query={activeQuery}
                      userRole={user.role}
                      onOpen={() => openResource(r)}
                      onSave={
                        isStudent
                          ? async () => {
                              try {
                                await api(`/api/resources/${r.id}/saved`, { method: 'PUT', body: '{}' });
                                toast('Saved to your library');
                              } catch (e) {
                                toast(e.message);
                              }
                            }
                          : null
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="empty">
                  <Search />
                  <h3>{mode === 'search' ? 'No matching resources found' : 'No materials to show'}</h3>
                  <p>
                    {mode === 'search'
                      ? 'Try different topic keywords or clear some filters.'
                      : 'Resources uploaded by faculty will appear here.'}
                  </p>
                  <button
                    onClick={() => {
                      setQuery('');
                      setFilters({ departmentId: '', courseId: '', semester: '', unitId: '', type: '', from: '', to: '' });
                      setCategory('All resources');
                      loadBrowse('browse');
                    }}
                  >
                    Reset Search and Filters
                  </button>
                </div>
              )}

              {/* PAGINATION */}
              {pages > 1 && (
                <div className="pagination">
                  <button disabled={page <= 1} onClick={() => (mode === 'search' ? submitSearch(page - 1) : loadBrowse(mode, page - 1))}>
                    Previous
                  </button>
                  <span>
                    Page {page} of {pages}
                  </span>
                  <button disabled={page >= pages} onClick={() => (mode === 'search' ? submitSearch(page + 1) : loadBrowse(mode, page + 1))}>
                    Next
                  </button>
                </div>
              )}
            </>
          )}

          {/* ========================================================
              VIEW 2: QUERIES SECTION (STUDENTS & STAFF)
              ======================================================== */}
          {mainNav === 'queries' && (
            <div className="queries-container">
              <div className="queries-top-bar">
                <div className="queries-title-group">
                  <h2>{isStudent ? 'My Academic Queries' : 'Student Queries & Questions'}</h2>
                  <p>
                    {isStudent
                      ? 'Ask questions to department faculty members and review detailed explanations.'
                      : 'Review student doubts from your department courses and provide prompt replies.'}
                  </p>
                </div>
                {isStudent && (
                  <button
                    className="primary"
                    onClick={() => {
                      setNewQueryTopic('');
                      setNewQueryQuestion('');
                      setNewQueryCourseId('');
                      setModal('askQuery');
                    }}
                  >
                    <Plus size={16} /> Ask a New Query
                  </button>
                )}
              </div>

              {/* TABS: ALL / PENDING / ANSWERED */}
              <div className="queries-tabs">
                <button className={`queries-tab-btn ${queryTab === 'all' ? 'active' : ''}`} onClick={() => setQueryTab('all')}>
                  All Queries ({queriesList.length})
                </button>
                <button className={`queries-tab-btn ${queryTab === 'pending' ? 'active' : ''}`} onClick={() => setQueryTab('pending')}>
                  Pending Queries ({queriesList.filter((q) => q.status === 'pending').length})
                </button>
                <button className={`queries-tab-btn ${queryTab === 'answered' ? 'active' : ''}`} onClick={() => setQueryTab('answered')}>
                  Answered ({queriesList.filter((q) => q.status === 'answered').length})
                </button>
              </div>

              {/* QUERIES LIST */}
              <div className="queries-list">
                {filteredQueries.length ? (
                  filteredQueries.map((q) => (
                    <article key={q.id} className="query-card">
                      <div className="query-card-head">
                        <div className="query-card-tags">
                          <span className="query-tag">{q.department_name || 'Engineering'}</span>
                          {q.course_name && <span className="query-tag">{q.course_name}</span>}
                          {q.resource_title && <span className="query-tag">Note: {q.resource_title}</span>}
                        </div>
                        <span className={`query-status-badge ${q.status}`}>
                          {q.status === 'pending' ? <Clock3 size={12} /> : <CheckCircle size={12} />}
                          {q.status === 'pending' ? 'Pending Faculty Reply' : 'Answered by Faculty'}
                        </span>
                      </div>

                      <h3 className="query-topic">{q.topic}</h3>
                      <div className="query-student-info">
                        Asked by <b>{q.student_name}</b> · {dateLabel(q.created_at)}
                      </div>

                      <div className="query-question-box">
                        <b>Question:</b>
                        <p style={{ margin: '4px 0 0' }}>{q.question}</p>
                      </div>

                      {/* Display Staff Reply if Answered */}
                      {q.reply && (
                        <div className="query-reply-box">
                          <div className="query-reply-header">
                            <span>
                              Response from <b>{q.replied_by_name || 'Faculty Member'}</b>
                            </span>
                            <small>{dateLabel(q.replied_at)}</small>
                          </div>
                          <div className="query-reply-content">{q.reply}</div>
                        </div>
                      )}

                      {/* Staff Reply Form - Only visible to Staff/Admin */}
                      {(isStaff || isAdmin) && (
                        <div className="query-staff-reply-form">
                          <label style={{ fontSize: '11px', fontWeight: 700, color: '#49465c' }}>
                            {q.reply ? 'Update Faculty Reply:' : 'Reply to Student:'}
                          </label>
                          <textarea
                            placeholder="Type your explanation, guidance, or answer for the student…"
                            value={replyTextMap[q.id] ?? (q.reply || '')}
                            onChange={(e) => setReplyTextMap({ ...replyTextMap, [q.id]: e.target.value })}
                          />
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                            <button className="primary" onClick={() => submitStaffReply(q.id)}>
                              <Send size={13} /> {q.reply ? 'Update Reply' : 'Submit Reply'}
                            </button>
                          </div>
                        </div>
                      )}
                    </article>
                  ))
                ) : (
                  <div className="empty">
                    <HelpCircle size={32} />
                    <h3>No queries in this category</h3>
                    <p>{isStudent ? 'Have a doubt about your coursework? Click “Ask a New Query”.' : 'All student queries have been answered!'}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ========================================================
              VIEW 3: CHAT SECTION (STUDENTS & STAFF)
              ======================================================== */}
          {mainNav === 'chat' && (
            <div className="chat-page">
              {/* CONTACTS SIDEBAR */}
              <div className="chat-sidebar-panel">
                <div className="chat-sidebar-head">
                  <h3>{isStudent ? 'Faculty Members' : 'Student Conversations'}</h3>
                  <input
                    className="chat-search-box"
                    placeholder="Search name or department…"
                    value={chatSearch}
                    onChange={(e) => setChatSearch(e.target.value)}
                  />
                </div>
                <div className="chat-contacts-list">
                  {filteredContacts.length ? (
                    filteredContacts.map((c) => (
                      <button
                        key={c.id}
                        className={`chat-contact-btn ${activeContact?.id === c.id ? 'active' : ''}`}
                        onClick={() => {
                          setActiveContact(c);
                          loadChatMessages(c.id);
                        }}
                      >
                        <div className="chat-avatar">{c.name.split(' ').map((x) => x[0]).slice(0, 2).join('')}</div>
                        <div className="chat-contact-info">
                          <div className="chat-contact-top">
                            <span className="chat-contact-name">{c.name}</span>
                            {c.last_message_at && <span className="chat-contact-time">{dateLabel(c.last_message_at)}</span>}
                          </div>
                          <span className="chat-contact-sub">
                            {c.department_name || c.department_code || 'Faculty'} {c.semester ? `· Sem ${c.semester}` : ''}
                          </span>
                          {c.last_message && <span className="chat-contact-preview">{c.last_message}</span>}
                        </div>
                        {c.unread_count > 0 && <span className="chat-badge">{c.unread_count}</span>}
                      </button>
                    ))
                  ) : (
                    <p className="hint" style={{ padding: '20px', textAlign: 'center' }}>
                      No contacts found.
                    </p>
                  )}
                </div>
              </div>

              {/* CHAT WINDOW */}
              <div className="chat-window">
                {activeContact ? (
                  <>
                    <div className="chat-window-head">
                      <div className="chat-avatar">{activeContact.name.split(' ').map((x) => x[0]).slice(0, 2).join('')}</div>
                      <div>
                        <b>{activeContact.name}</b>
                        <small>
                          {activeContact.role} · {activeContact.department_name || 'Engineering'}
                        </small>
                      </div>
                    </div>

                    <div className="chat-messages-area">
                      {chatMessages.length ? (
                        chatMessages.map((m) => {
                          const isMine = m.sender_id === user.id;
                          return (
                            <div key={m.id} className={`chat-bubble ${isMine ? 'mine' : ''}`}>
                              {!isMine && <span className="chat-bubble-sender">{m.sender_name || activeContact.name}</span>}
                              <div className="chat-bubble-text">{m.message}</div>
                              <span className="chat-bubble-meta">{dateLabel(m.created_at)}</span>
                            </div>
                          );
                        })
                      ) : (
                        <div className="chat-empty-state">
                          <MessageSquare size={36} />
                          <p>Start a conversation with {activeContact.name}.</p>
                        </div>
                      )}
                    </div>

                    <form className="chat-input-bar" onSubmit={sendChatMessage}>
                      <textarea
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendChatMessage(e);
                          }
                        }}
                        placeholder={`Type a message to ${activeContact.name}… (Press Enter to send)`}
                        maxLength={3000}
                        required
                      />
                      <button className="chat-send-btn" type="submit" disabled={!chatInput.trim()}>
                        <Send size={14} /> Send
                      </button>
                    </form>
                  </>
                ) : (
                  <div className="chat-empty-state">
                    <MessageSquare size={48} />
                    <h3>Select a contact to start chatting</h3>
                    <p>Communicate directly between students and faculty members.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ========================================================
              VIEW 4: ADMIN HUB (ONLY FOR ADMIN ROLE)
              ======================================================== */}
          {mainNav === 'admin' && isAdmin && (
            <div>
              {/* ADMIN TABS */}
              <div className="admin-hub-nav">
                <button
                  className={`admin-nav-item ${adminTab === 'departments' ? 'active' : ''}`}
                  onClick={() => setAdminTab('departments')}
                >
                  <BuildingIcon size={14} /> Engineering Departments ({departments.length})
                </button>
                <button className={`admin-nav-item ${adminTab === 'courses' ? 'active' : ''}`} onClick={() => setAdminTab('courses')}>
                  <BookOpen size={14} /> Courses ({courses.length})
                </button>
                <button className={`admin-nav-item ${adminTab === 'users' ? 'active' : ''}`} onClick={() => setAdminTab('users')}>
                  <Users size={14} /> User Accounts ({(adminData.users || []).length})
                </button>
                <button className={`admin-nav-item ${adminTab === 'resources' ? 'active' : ''}`} onClick={() => setAdminTab('resources')}>
                  <Library size={14} /> Library Catalog ({(adminData.resources || []).length})
                </button>
                <button className={`admin-nav-item ${adminTab === 'reports' ? 'active' : ''}`} onClick={() => setAdminTab('reports')}>
                  <ShieldAlert size={14} /> Reports ({(adminData.reports || []).length})
                </button>
                <button className={`admin-nav-item ${adminTab === 'audit' ? 'active' : ''}`} onClick={() => setAdminTab('audit')}>
                  <History size={14} /> Audit History
                </button>
                <button className={`admin-nav-item ${adminTab === 'backup' ? 'active' : ''}`} onClick={() => setAdminTab('backup')}>
                  <RefreshCw size={14} /> System Backup
                </button>
              </div>

              {/* ADMIN TAB 1: ALL 18 ENGINEERING DEPARTMENTS */}
              {adminTab === 'departments' && (
                <div className="admin-card-section">
                  <h3>All Engineering Departments ({departments.length})</h3>
                  <p className="hint">All accredited engineering branches available on campus.</p>

                  <form
                    className="admin-create"
                    style={{ marginTop: '14px' }}
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      try {
                        await api('/api/admin/departments', {
                          method: 'POST',
                          body: JSON.stringify(Object.fromEntries(f))
                        });
                        toast('Department added successfully');
                        e.target.reset();
                        loadCoursesAndDepts();
                      } catch (err) {
                        toast(err.message);
                      }
                    }}
                  >
                    <b>Add New Engineering Department</b>
                    <input name="name" required placeholder="Full Department Name" />
                    <input name="code" required placeholder="Department Code (e.g. CSE)" />
                    <button className="primary">Add Department</button>
                  </form>

                  <div className="admin-grid-departments">
                    {departments.map((d) => (
                      <div key={d.id} className="dept-badge-card">
                        <div>
                          <b>{d.name}</b>
                          <small>{d.code}</small>
                        </div>
                        <div style={{ display: 'flex', gap: '5px' }}>
                          <button
                            className="secondary"
                            style={{ padding: '4px 8px', fontSize: '9px' }}
                            onClick={async () => {
                              const name = window.prompt('Edit Department Name:', d.name);
                              const code = name && window.prompt('Edit Department Code:', d.code);
                              if (name && code) {
                                try {
                                  await api(`/api/admin/departments/${d.id}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ name, code })
                                  });
                                  toast('Department updated');
                                  loadCoursesAndDepts();
                                } catch (err) {
                                  toast(err.message);
                                }
                              }
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="secondary danger"
                            style={{ padding: '4px 8px', fontSize: '9px' }}
                            onClick={async () => {
                              if (window.confirm(`Delete ${d.name}? (Departments with active courses cannot be deleted)`)) {
                                try {
                                  await api(`/api/admin/departments/${d.id}`, { method: 'DELETE' });
                                  toast('Department removed');
                                  loadCoursesAndDepts();
                                } catch (err) {
                                  toast(err.message);
                                }
                              }
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ADMIN TAB 2: COURSES */}
              {adminTab === 'courses' && (
                <div className="admin-card-section">
                  <h3>Academic Courses ({courses.length})</h3>
                  <form
                    className="admin-create"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      try {
                        await api('/api/admin/courses', {
                          method: 'POST',
                          body: JSON.stringify(Object.fromEntries(f))
                        });
                        toast('Course added successfully');
                        e.target.reset();
                        loadCoursesAndDepts();
                      } catch (err) {
                        toast(err.message);
                      }
                    }}
                  >
                    <b>Add New Course</b>
                    <input name="name" required placeholder="Course Name" />
                    <input name="code" required placeholder="Course Code" />
                    <select name="department_id" required>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.code})
                        </option>
                      ))}
                    </select>
                    <input name="semester" type="number" min="1" max="12" required placeholder="Semester (1-8)" />
                    <button className="primary">Add Course</button>
                  </form>

                  <div className="admin-list" style={{ marginTop: '16px' }}>
                    {courses.map((c) => (
                      <div key={c.id}>
                        <span>
                          <b>{c.name}</b>
                          <small>
                            {c.code} · {c.department} · Semester {c.semester}
                          </small>
                        </span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            className="secondary"
                            onClick={async () => {
                              const name = window.prompt('Edit Course Name:', c.name);
                              if (name) {
                                await api(`/api/admin/courses/${c.id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
                                toast('Course renamed');
                                loadCoursesAndDepts();
                              }
                            }}
                          >
                            Rename
                          </button>
                          <button
                            className="secondary danger"
                            onClick={async () => {
                              if (window.confirm(`Archive ${c.name}?`)) {
                                await api(`/api/admin/courses/${c.id}`, { method: 'DELETE' });
                                toast('Course archived');
                                loadCoursesAndDepts();
                              }
                            }}
                          >
                            Archive
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ADMIN TAB 3: USERS */}
              {adminTab === 'users' && (
                <div className="admin-card-section">
                  <h3>User Accounts ({(adminData.users || []).length})</h3>
                  <form
                    className="admin-create"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      try {
                        await api('/api/admin/users', {
                          method: 'POST',
                          body: JSON.stringify(Object.fromEntries(f))
                        });
                        toast('User account created');
                        e.target.reset();
                        openAdminData();
                      } catch (err) {
                        toast(err.message);
                      }
                    }}
                  >
                    <b>Create New Account</b>
                    <input name="name" required placeholder="Full Name" />
                    <input name="email" required type="email" placeholder="Email Address" />
                    <input name="password" required type="password" minLength="10" placeholder="Password (10+ characters)" />
                    <select name="role">
                      <option>Student</option>
                      <option>Staff</option>
                      <option>Admin</option>
                    </select>
                    <select name="department_id">
                      <option value="">No Department</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <input name="semester" type="number" min="1" max="12" placeholder="Semester (Students)" />
                    <button className="primary">Create User</button>
                  </form>

                  <div className="admin-list" style={{ marginTop: '16px' }}>
                    {(adminData.users || []).map((u) => (
                      <div key={u.id}>
                        <span>
                          <b>{u.name}</b>
                          <small>
                            {u.email} · {u.role}
                            {u.active ? '' : ' · (Account Disabled)'}
                          </small>
                        </span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <select
                            value={u.role}
                            onChange={async (e) => {
                              await api(`/api/admin/users/${u.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ role: e.target.value })
                              });
                              toast(`Role updated to ${e.target.value}`);
                              openAdminData();
                            }}
                          >
                            <option>Student</option>
                            <option>Staff</option>
                            <option>Admin</option>
                          </select>
                          <button
                            className="secondary danger"
                            onClick={async () => {
                              if (!window.confirm(`Disable access for ${u.name}?`)) return;
                              try {
                                await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
                                toast('Account disabled');
                                openAdminData();
                              } catch (err) {
                                toast(err.message);
                              }
                            }}
                          >
                            Disable
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ADMIN TAB 4: RESOURCES MODERATION */}
              {adminTab === 'resources' && (
                <div className="admin-card-section">
                  <h3>Library Materials Moderation ({(adminData.resources || []).length})</h3>
                  <div className="admin-list">
                    {(adminData.resources || []).map((r) => (
                      <div key={r.id}>
                        <span>
                          <b>{r.title}</b>
                          <small>
                            {r.course} · Uploaded by {r.uploader} · {r.type}
                          </small>
                        </span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button className="secondary" onClick={() => openResource(r)}>
                            Open
                          </button>
                          <button
                            className="secondary danger"
                            onClick={async () => {
                              if (!window.confirm(`Remove “${r.title}”?`)) return;
                              try {
                                await api(`/api/admin/resources/${r.id}/remove`, {
                                  method: 'POST',
                                  body: JSON.stringify({ reason: 'admin' })
                                });
                                toast('Resource removed');
                                openAdminData();
                                loadBrowse('browse');
                              } catch (err) {
                                toast(err.message);
                              }
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ADMIN TAB 5: REPORTS */}
              {adminTab === 'reports' && (
                <div className="admin-card-section">
                  <h3>Reported Content ({(adminData.reports || []).length})</h3>
                  <div className="admin-list">
                    {(adminData.reports || []).map((r) => (
                      <div key={r.id}>
                        <span>
                          <b>{r.resource}</b>
                          <small>
                            Reason: {r.reason} · Reporter: {r.reporter} · Status: {r.status}
                          </small>
                        </span>
                        <select
                          value={r.status}
                          onChange={async (e) => {
                            await api(`/api/admin/reports/${r.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ status: e.target.value })
                            });
                            toast('Status updated');
                            openAdminData();
                          }}
                        >
                          <option>open</option>
                          <option>reviewing</option>
                          <option>resolved</option>
                          <option>dismissed</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ADMIN TAB 6: AUDIT LOGS */}
              {adminTab === 'audit' && (
                <div className="admin-card-section">
                  <h3>Recent Audit Trail</h3>
                  <div className="admin-list">
                    {(adminData.audit || []).slice(0, 30).map((a) => (
                      <div key={a.id}>
                        <span>
                          <b>
                            {a.action} {a.entity_type}
                          </b>
                          <small>
                            Performed by: {a.actor || 'System'} · {a.details} · {dateLabel(a.created_at)}
                          </small>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ADMIN TAB 7: BACKUP */}
              {adminTab === 'backup' && (
                <div className="admin-card-section">
                  <h3>Data Backup Management</h3>
                  <p className="hint">Create full database and file storage backups with one click.</p>
                  <button
                    className="primary"
                    style={{ marginTop: '12px' }}
                    onClick={async () => {
                      try {
                        const d = await api('/api/admin/backups', { method: 'POST', body: '{}' });
                        toast(`Backup created: ${d.id}`);
                        openAdminData();
                      } catch (err) {
                        toast(err.message);
                      }
                    }}
                  >
                    <RefreshCw size={14} /> Create New Backup
                  </button>

                  <div className="admin-list" style={{ marginTop: '18px' }}>
                    {(adminData.backups || []).map((b) => (
                      <div key={b.id}>
                        <span>
                          <b>Backup: {b.id}</b>
                          <small>{dateLabel(b.created_at)}</small>
                        </span>
                        <span style={{ fontSize: '10px', color: '#1a7f37', fontWeight: 700 }}>Saved</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <footer>
            <span>© 2026 CourseVault Academic System</span>
            <span>All Engineering Departments Supported</span>
            <span>Role: {user.role}</span>
          </footer>
        </section>
      </main>

      {/* ========================================================
          MODAL 1: RESOURCE DETAIL VIEW
          ======================================================== */}
      {modal === 'resource' && detail && (
        <Modal title="Resource Details" close={() => setModal('')}>
          <div className="resource-detail">
            <span className="type-chip">{detail.type}</span>
            <h2>{detail.title}</h2>
            <p className="detail-meta">
              {detail.department} · {detail.course} · {detail.unit} · Semester {detail.semester}
            </p>
            <div className="rating-line">
              <b>
                <Star size={15} fill="currentColor" />
                {Number(detail.average_rating || 0).toFixed(1)}
              </b>
              <span>({detail.rating_count || 0} student ratings)</span>
              <span className="date-line">
                <Clock3 size={13} />
                {dateLabel(detail.created_at)}
              </span>
            </div>
            <p>{detail.description || 'No description provided.'}</p>

            {detail.content && (
              <div className="content-preview">
                <b>Summary & Key Concepts</b>
                <p>
                  <Marked text={detail.content} query={activeQuery} />
                </p>
              </div>
            )}

            {detail.external_url ? (
              <div className="preview">
                <iframe
                  title="Video Lecture Preview"
                  src={
                    detail.external_url.includes('youtu.be')
                      ? `https://www.youtube-nocookie.com/embed/${detail.external_url.split('/').pop()}`
                      : detail.external_url.replace('youtube.com/watch?v=', 'youtube-nocookie.com/embed/')
                  }
                  allow="encrypted-media; picture-in-picture"
                />
              </div>
            ) : detail.file_path && detail.file_available ? (
              <div className="preview">
                <iframe title={`Preview ${detail.title}`} src={`/api/resources/${detail.id}/file`} />
                <a className="download-link" href={`/api/resources/${detail.id}/file?download=1`}>
                  <Download size={15} /> Download Resource Document
                </a>
              </div>
            ) : (
              <p className="hint">No attachment file associated with this item.</p>
            )}

            {/* Student Star Rating */}
            {isStudent && (
              <div className="rating-action">
                <b>Rate this material:</b>
                <div>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} aria-label={`Rate ${n} stars`} onClick={() => saveRating(n)}>
                      <Star size={20} fill={Number(detail.average_rating) >= n ? 'currentColor' : 'none'} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="detail-actions">
              {isStudent && (
                <>
                  <button
                    className="primary"
                    onClick={() => {
                      setNewQueryTopic(`Doubt regarding: ${detail.title}`);
                      setNewQueryCourseId(String(detail.course_id || ''));
                      setNewQueryResourceId(detail.id);
                      setModal('askQuery');
                    }}
                  >
                    <HelpCircle size={15} /> Ask Query about this Material
                  </button>
                  <button className="secondary" onClick={() => setModal('report')}>
                    <ShieldAlert size={15} /> Report Issue
                  </button>
                </>
              )}

              {/* Staff Editing Controls */}
              {isStaff && detail.uploader_id === user.id && (
                <>
                  <button
                    className="secondary"
                    onClick={() => {
                      setUploadTarget(detail);
                      setUploadError('');
                      setModal('upload');
                    }}
                  >
                    Edit / Upload New Version
                  </button>
                  <button
                    className="secondary danger"
                    onClick={async () => {
                      if (!window.confirm('Remove this resource from the library?')) return;
                      try {
                        await api(`/api/resources/${detail.id}`, { method: 'DELETE' });
                        toast('Resource removed');
                        setModal('');
                        await loadBrowse('browse');
                      } catch (e) {
                        toast(e.message);
                      }
                    }}
                  >
                    Remove Resource
                  </button>
                </>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* ========================================================
          MODAL 2: ASK A QUERY (STUDENTS)
          ======================================================== */}
      {modal === 'askQuery' && (
        <Modal title="Ask an Academic Query" close={() => setModal('')}>
          <p className="hint">Submit your doubt to faculty members. Staff will review and post a detailed reply.</p>
          <form className="stack-form" onSubmit={submitStudentQuery}>
            <label>
              Course / Subject
              <select value={newQueryCourseId} onChange={(e) => setNewQueryCourseId(e.target.value)}>
                <option value="">Select a Course (optional)</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · Sem {c.semester} ({c.department})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Topic / Question Title
              <input
                required
                maxLength={180}
                placeholder="e.g. Peterson Algorithm Mutual Exclusion proof"
                value={newQueryTopic}
                onChange={(e) => setNewQueryTopic(e.target.value)}
              />
            </label>
            <label>
              Your Question Details
              <textarea
                required
                maxLength={4000}
                placeholder="Explain what concept you need help with, any specific question numbers, or where you got stuck…"
                value={newQueryQuestion}
                onChange={(e) => setNewQueryQuestion(e.target.value)}
              />
            </label>
            <button className="primary full">Submit Query to Faculty</button>
          </form>
        </Modal>
      )}

      {/* ========================================================
          MODAL 3: UPLOAD STUDY MATERIAL (STAFF)
          ======================================================== */}
      {modal === 'upload' && (
        <Modal title={uploadTarget ? 'Update Study Material' : 'Upload Study Material'} close={() => setModal('')}>
          <form className="stack-form" onSubmit={submitUpload} encType="multipart/form-data">
            <label>
              Title
              <input name="title" required defaultValue={uploadTarget?.title || ''} maxLength={180} placeholder="e.g. Unit 3 Process Synchronization Notes" />
            </label>
            <label>
              Course
              <select name="course_id" required defaultValue={uploadTarget?.course_id || ''}>
                <option value="" disabled>
                  Select a Course
                </option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · Semester {c.semester} ({c.department})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Unit / Topic
              <input name="unit" required defaultValue={uploadTarget?.unit || ''} placeholder="e.g. Unit 3 · Processes & Threads" />
            </label>
            <label>
              Material Type
              <select name="type" defaultValue={uploadTarget?.type || 'Notes'}>
                {Object.keys(icons).map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              Description
              <textarea name="description" defaultValue={uploadTarget?.description || ''} maxLength={3000} placeholder="Brief summary for students…" />
            </label>
            <label>
              Key Concepts & Notes Summary
              <textarea
                name="content"
                defaultValue={uploadTarget?.content || ''}
                maxLength={50000}
                placeholder="Key topics covered, formulas, theorems, or searchable summary…"
              />
            </label>
            <label>
              File Document (PDF, PPT/PPTX, DOC/DOCX, TXT; up to 25 MB)
              <input type="file" name="file" accept=".pdf,.ppt,.pptx,.doc,.docx,.txt" />
            </label>
            <label>
              Video Lecture URL (YouTube / Vimeo)
              <input name="external_url" defaultValue={uploadTarget?.external_url || ''} type="url" placeholder="https://www.youtube.com/…" />
            </label>
            <label className="checkline">
              <input type="checkbox" name="notify_updates" value="1" defaultChecked /> Notify department students about this upload
            </label>
            {uploadError && <p className="form-error">{uploadError}</p>}
            <button className="primary full">{uploadTarget ? 'Save Updated Version' : 'Upload Material'}</button>
          </form>
        </Modal>
      )}

      {/* ========================================================
          MODAL 4: USER PROFILE
          ======================================================== */}
      {modal === 'profile' && (
        <Modal title="Your Profile" close={() => setModal('')}>
          <form
            className="stack-form"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const d = await api('/api/users/me', { method: 'PATCH', body: JSON.stringify(profile) });
                setUser(d.user);
                toast('Profile updated successfully');
                setModal('');
              } catch (x) {
                toast(x.message);
              }
            }}
          >
            <label>
              Full Name
              <input value={profile.name || user.name} onChange={(e) => setProfile((s) => ({ ...s, name: e.target.value }))} required />
            </label>
            <label>
              Engineering Department
              <select value={profile.department_id || ''} onChange={(e) => setProfile((s) => ({ ...s, department_id: e.target.value }))}>
                <option value="">No Department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </select>
            </label>
            {isStudent && (
              <label>
                Current Semester
                <input
                  type="number"
                  min="1"
                  max="12"
                  value={profile.semester || ''}
                  onChange={(e) => setProfile((s) => ({ ...s, semester: e.target.value }))}
                />
              </label>
            )}
            <button className="primary full">Save Profile</button>
          </form>
        </Modal>
      )}

      {/* ========================================================
          MODAL 5: NOTIFICATIONS
          ======================================================== */}
      {modal === 'notifications' && (
        <Modal title={`Notifications${unread ? ` · ${unread} unread` : ''}`} close={() => setModal('')}>
          <div className="notification-list">
            {notifications.length ? (
              notifications.map((n) => (
                <button key={n.id} className={`notice-item ${n.read_at ? '' : 'unread'}`} onClick={() => markRead(n.id)}>
                  <b>{n.title}</b>
                  <span>{n.body}</span>
                  <small>
                    {dateLabel(n.created_at)}
                    {n.read_at ? ' · Read' : ' · Click to mark read'}
                  </small>
                </button>
              ))
            ) : (
              <p className="hint">You have no new notifications.</p>
            )}
          </div>
          {notifications.length > 0 && (
            <button
              className="linkbtn"
              onClick={async () => {
                await api('/api/notifications/read-all', { method: 'PATCH', body: '{}' });
                refreshNotifications();
              }}
            >
              Mark all as read
            </button>
          )}
        </Modal>
      )}

      {/* ========================================================
          MODAL 6: SEARCH HISTORY
          ======================================================== */}
      {modal === 'history' && (
        <Modal title="Recent Searches" close={() => setModal('')}>
          <div className="history-list">
            {history.length ? (
              history.map((h) => (
                <button
                  key={h.id}
                  onClick={() => {
                    setQuery(h.query);
                    setModal('');
                    setMainNav('library');
                    setTimeout(() => submitSearch(1, { q: h.query }), 0);
                  }}
                >
                  <Search size={15} />
                  <span>{h.query}</span>
                  <small>{dateLabel(h.created_at)}</small>
                </button>
              ))
            ) : (
              <p className="hint">Your search queries will appear here.</p>
            )}
          </div>
          {history.length > 0 && (
            <button
              className="secondary"
              onClick={async () => {
                await api('/api/search/history', { method: 'DELETE' });
                setHistory([]);
              }}
            >
              Clear History
            </button>
          )}
        </Modal>
      )}

      {/* ========================================================
          MODAL 7: REPORT RESOURCE
          ======================================================== */}
      {modal === 'report' && (
        <Modal title="Report Material Issue" close={() => setModal('resource')}>
          <p className="hint">Let our academic administrators know what needs attention.</p>
          <form className="stack-form" onSubmit={report}>
            <label>
              Reason
              <select value={reportReason} onChange={(e) => setReportReason(e.target.value)}>
                <option value="incorrect">Incorrect Information</option>
                <option value="duplicate">Duplicate Resource</option>
                <option value="outdated">Outdated Syllabus</option>
                <option value="inappropriate">Inappropriate Content</option>
              </select>
            </label>
            <label>
              Details
              <textarea name="details" maxLength={1000} placeholder="Please provide additional context…" />
            </label>
            <button className="primary full">Submit Report</button>
          </form>
        </Modal>
      )}

      {/* Toast Notice */}
      {notice && (
        <div className="toast">
          <Check size={16} />
          {notice}
        </div>
      )}
    </div>
  );
}

function ResourceCard({ resource: r, query, userRole, onOpen, onSave }) {
  const Icon = icons[r.type] || FileText;
  return (
    <article className="card">
      <div className={`art ${['lavender', 'peach', 'mint', 'blue', 'pink', 'yellow'][r.id % 6]}`}>
        <div className="arttop">
          <span>
            <Icon size={13} />
            {r.type}
          </span>
          <span className="resource-stars">
            <Star size={13} fill="currentColor" />
            {Number(r.average_rating || 0).toFixed(1)}
          </span>
          {onSave && (
            <button
              className="save-chip"
              onClick={(e) => {
                e.stopPropagation();
                onSave();
              }}
              aria-label="Save resource"
            >
              <Bookmark size={13} />
            </button>
          )}
        </div>
        <Icon className="watermark" size={51} />
        <small>{r.course}</small>
      </div>
      <div className="cardbody">
        <small className="meta">
          {r.department} · {r.unit}
        </small>
        <h3>
          <Marked text={r.title} query={query} />
        </h3>
        <p className="card-desc">
          <Marked text={r.description} query={query} />
        </p>
        <div className="rating">
          <b>
            <Star size={14} fill="currentColor" />
            {Number(r.average_rating || 0).toFixed(1)}
          </b>
          <span>({r.rating_count || 0} ratings)</span>
          <small>
            <Clock3 size={12} />
            {dateLabel(r.created_at)}
          </small>
        </div>
        <div className="cardfoot">
          <span>
            <i>
              {(r.uploader || 'CourseVault')
                .split(' ')
                .map((s) => s[0])
                .slice(-2)
                .join('')}
            </i>
            {r.uploader || 'CourseVault'}
            {r.file_path && !r.file_available && <em>attachment unavailable</em>}
          </span>
          <button onClick={onOpen} aria-label={`Open ${r.title}`}>
            <ArrowUpRight size={17} />
          </button>
        </div>
      </div>
    </article>
  );
}

function Modal({ title, close, children, wide }) {
  return (
    <div className="modal-backdrop" onClick={close}>
      <section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button onClick={close} aria-label="Close">
            <X />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

function BuildingIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01" />
      <path d="M16 6h.01" />
      <path d="M8 10h.01" />
      <path d="M16 10h.01" />
      <path d="M8 14h.01" />
      <path d="M16 14h.01" />
    </svg>
  );
}

createRoot(document.getElementById('root')).render(<App />);
