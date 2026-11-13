import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.resolve(here, '../.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
export const dataDir = path.resolve(here, '../data');
export const uploadDir = path.join(dataDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
export const db = new Database(path.join(dataDir, 'coursevault.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('Student','Staff','Admin')),
 department_id INTEGER, semester INTEGER, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(department_id) REFERENCES departments(id)
);
CREATE TABLE IF NOT EXISTS departments(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, code TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS courses(id INTEGER PRIMARY KEY, department_id INTEGER NOT NULL, name TEXT NOT NULL, code TEXT NOT NULL,
 semester INTEGER NOT NULL DEFAULT 1, description TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
 UNIQUE(department_id,code), FOREIGN KEY(department_id) REFERENCES departments(id));
CREATE TABLE IF NOT EXISTS resources (
 id INTEGER PRIMARY KEY, title TEXT NOT NULL, subject TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '',
 unit TEXT NOT NULL DEFAULT '', department_id INTEGER NOT NULL, course_id INTEGER NOT NULL, semester INTEGER NOT NULL,
 type TEXT NOT NULL, file_path TEXT, original_name TEXT, external_url TEXT, mime_type TEXT, file_hash TEXT,
 uploader_id INTEGER NOT NULL, visibility TEXT NOT NULL DEFAULT 'department', active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(department_id) REFERENCES departments(id), FOREIGN KEY(course_id) REFERENCES courses(id), FOREIGN KEY(uploader_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS ratings(id INTEGER PRIMARY KEY, resource_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
 value INTEGER NOT NULL CHECK(value BETWEEN 1 AND 5), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(resource_id,student_id), FOREIGN KEY(resource_id) REFERENCES resources(id) ON DELETE CASCADE,
 FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, resource_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
 staff_id INTEGER NOT NULL, sender_id INTEGER NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','delivered','read')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(resource_id) REFERENCES resources(id) ON DELETE CASCADE,
 FOREIGN KEY(student_id) REFERENCES users(id), FOREIGN KEY(staff_id) REFERENCES users(id), FOREIGN KEY(sender_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
 body TEXT NOT NULL DEFAULT '', resource_id INTEGER, message_id INTEGER, read_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(resource_id) REFERENCES resources(id) ON DELETE SET NULL,
 FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS notification_preferences(user_id INTEGER PRIMARY KEY, messages INTEGER NOT NULL DEFAULT 1,
 resource_updates INTEGER NOT NULL DEFAULT 1, ratings INTEGER NOT NULL DEFAULT 1,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY, resource_id INTEGER NOT NULL, reporter_id INTEGER NOT NULL,
 reason TEXT NOT NULL, details TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(resource_id) REFERENCES resources(id) ON DELETE CASCADE, FOREIGN KEY(reporter_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS resource_versions(id INTEGER PRIMARY KEY, resource_id INTEGER NOT NULL, version INTEGER NOT NULL,
 title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', file_path TEXT, original_name TEXT,
 file_hash TEXT, editor_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(resource_id,version), FOREIGN KEY(resource_id) REFERENCES resources(id) ON DELETE CASCADE, FOREIGN KEY(editor_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS search_history(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, query TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS saved_resources(user_id INTEGER NOT NULL,resource_id INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id,resource_id),FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,FOREIGN KEY(resource_id) REFERENCES resources(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS reset_tokens(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, token_hash TEXT NOT NULL,
 expires_at TEXT NOT NULL, used_at TEXT, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY, actor_id INTEGER, action TEXT NOT NULL, entity_type TEXT NOT NULL,
 entity_id INTEGER, details TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS activity_logs(id INTEGER PRIMARY KEY, level TEXT NOT NULL, event TEXT NOT NULL, details TEXT DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS student_queries (
 id INTEGER PRIMARY KEY,
 student_id INTEGER NOT NULL,
 department_id INTEGER NOT NULL,
 course_id INTEGER,
 resource_id INTEGER,
 topic TEXT NOT NULL,
 question TEXT NOT NULL,
 reply TEXT,
 replied_by INTEGER,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'answered', 'closed')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 replied_at TEXT,
 FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(department_id) REFERENCES departments(id) ON DELETE CASCADE,
 FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE SET NULL,
 FOREIGN KEY(resource_id) REFERENCES resources(id) ON DELETE SET NULL,
 FOREIGN KEY(replied_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
 id INTEGER PRIMARY KEY,
 sender_id INTEGER NOT NULL,
 recipient_id INTEGER NOT NULL,
 message TEXT NOT NULL,
 read_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(recipient_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_courses_department ON courses(department_id,semester);
CREATE INDEX IF NOT EXISTS idx_resources_course ON resources(course_id,semester,unit);
CREATE INDEX IF NOT EXISTS idx_resources_uploader ON resources(uploader_id);
CREATE INDEX IF NOT EXISTS idx_resources_recent ON resources(active,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ratings_resource ON ratings(resource_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(resource_id,student_id,created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id,read_at,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status,created_at);
CREATE INDEX IF NOT EXISTS idx_history_user ON search_history(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_queries_dept ON student_queries(department_id, status);
CREATE INDEX IF NOT EXISTS idx_queries_student ON student_queries(student_id);
CREATE INDEX IF NOT EXISTS idx_chat_convo ON chat_messages(sender_id, recipient_id, created_at);
`);

try { db.exec('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1'); } catch (error) { if (!/duplicate column/i.test(error.message)) throw error; }

export const ENGINEERING_DEPARTMENTS = [
  ['Computer Science & Engineering', 'CSE'],
  ['Information Technology', 'IT'],
  ['Electronics & Communication Engineering', 'ECE'],
  ['Electrical & Electronics Engineering', 'EEE'],
  ['Mechanical Engineering', 'ME'],
  ['Civil Engineering', 'CE'],
  ['Chemical Engineering', 'CHE'],
  ['Aerospace Engineering', 'AE'],
  ['Biomedical Engineering', 'BME'],
  ['Biotechnology Engineering', 'BT'],
  ['Artificial Intelligence & Data Science', 'AI&DS'],
  ['Robotics & Automation Engineering', 'RAE'],
  ['Automobile Engineering', 'AME'],
  ['Environmental Engineering', 'ENV'],
  ['Metallurgical & Materials Engineering', 'MME'],
  ['Industrial & Production Engineering', 'IPE'],
  ['Agricultural Engineering', 'AGR'],
  ['Marine Engineering', 'MRNE']
];

function ensureSeed() {
  try {
    db.prepare("UPDATE departments SET name='Computer Science & Engineering' WHERE code='CSE'").run();
    db.prepare("UPDATE departments SET name='Electronics & Communication Engineering' WHERE code='ECE'").run();
    db.prepare("UPDATE departments SET name='Electrical & Electronics Engineering' WHERE code='EEE'").run();
    db.prepare("UPDATE departments SET name='Mechanical Engineering' WHERE code='ME'").run();
  } catch {}

  const insertDept = db.prepare('INSERT OR IGNORE INTO departments(name,code) VALUES (?,?)');
  for (const d of ENGINEERING_DEPARTMENTS) {
    insertDept.run(...d);
  }

  const deptMap = {};
  for (const row of db.prepare('SELECT id, code FROM departments').all()) {
    deptMap[row.code] = row.id;
  }

  const insertCourse = db.prepare('INSERT OR IGNORE INTO courses(department_id,name,code,semester,description) VALUES (?,?,?,?,?)');
  
  const allCourses = [
    // CSE
    [deptMap['CSE'], 'Operating Systems', 'CS301', 5, 'Processes, memory management, synchronization, and file systems'],
    [deptMap['CSE'], 'Design & Analysis of Algorithms', 'CS302', 5, 'Algorithm design strategies, dynamic programming, and complexity'],
    [deptMap['CSE'], 'Discrete Mathematics', 'CS303', 5, 'Logic, sets, relations, graphs, and combinatorics'],
    [deptMap['CSE'], 'Database Management Systems', 'CS304', 5, 'Relational databases, SQL, normalization, and ACID transactions'],
    [deptMap['CSE'], 'Computer Networks', 'CS305', 5, 'Network protocols, TCP/IP stack, routing, and switching'],
    [deptMap['CSE'], 'Data Structures & Algorithms', 'CS201', 3, 'Core linear data structures, trees, and graph algorithms'],

    // IT
    [deptMap['IT'], 'Web Technologies & Frameworks', 'IT301', 5, 'Client-server architecture, modern web development, and APIs'],
    [deptMap['IT'], 'Cloud Computing Architecture', 'IT302', 5, 'Virtualization, microservices, cloud deployments, and storage'],
    [deptMap['IT'], 'Cyber Security & Cryptography', 'IT303', 6, 'Network security, symmetric/asymmetric encryption, and threat analysis'],
    [deptMap['IT'], 'Software Engineering', 'IT304', 4, 'SDLC models, agile methodologies, testing, and system design'],

    // ECE
    [deptMap['ECE'], 'Digital Systems & Microprocessors', 'EC301', 5, 'Digital logic, computer organization, and processor architecture'],
    [deptMap['ECE'], 'Signals and Systems', 'EC302', 4, 'Continuous and discrete time signals, Fourier and Laplace transforms'],
    [deptMap['ECE'], 'VLSI Design & Fabrication', 'EC303', 6, 'CMOS circuit design, layout, and semiconductor fabrication'],
    [deptMap['ECE'], 'Analog Communication Systems', 'EC304', 4, 'Modulation techniques, receivers, noise analysis, and RF circuits'],

    // EEE
    [deptMap['EEE'], 'Electrical Machines', 'EE301', 4, 'Transformers, induction motors, synchronous generators, and DC machines'],
    [deptMap['EEE'], 'Power Systems Analysis', 'EE302', 5, 'Transmission lines, fault analysis, stability, and power distribution'],
    [deptMap['EEE'], 'Control Systems Engineering', 'EE303', 5, 'Transfer functions, root locus, Bode plots, and state variable models'],
    [deptMap['EEE'], 'Power Electronics & Drives', 'EE304', 6, 'Thyristors, inverters, converters, and motor speed control'],

    // ME
    [deptMap['ME'], 'Engineering Thermodynamics', 'ME301', 3, 'Laws of thermodynamics, heat cycles, entropy, and pure substances'],
    [deptMap['ME'], 'Fluid Mechanics & Hydraulic Machinery', 'ME302', 4, 'Fluid statics, Bernoulli equation, pumps, and turbines'],
    [deptMap['ME'], 'Theory of Machines', 'ME303', 5, 'Kinematics of mechanisms, gear trains, governors, and balancing'],
    [deptMap['ME'], 'Manufacturing Technology', 'ME304', 4, 'Casting, forming, welding, and advanced CNC machining'],

    // CE
    [deptMap['CE'], 'Structural Analysis', 'CE301', 5, 'Determinate and indeterminate structures, slope-deflection, and moments'],
    [deptMap['CE'], 'Concrete Technology & Design', 'CE302', 5, 'Mix design, reinforced concrete beams, slabs, and limit state design'],
    [deptMap['CE'], 'Surveying & Geomatics', 'CE303', 3, 'Leveling, theodolite surveying, total stations, and GPS mapping'],
    [deptMap['CE'], 'Geotechnical Engineering', 'CE304', 5, 'Soil mechanics, bearing capacity, foundations, and soil slope stability'],

    // CHE
    [deptMap['CHE'], 'Chemical Reaction Engineering', 'CH301', 5, 'Kinetics of reactions, ideal reactor design (CSTR, PFR), and catalysis'],
    [deptMap['CHE'], 'Heat Transfer Operations', 'CH302', 4, 'Conduction, convection, radiation, and heat exchanger design'],
    [deptMap['CHE'], 'Mass Transfer Operations', 'CH303', 5, 'Distillation, absorption, liquid-liquid extraction, and drying'],

    // AE
    [deptMap['AE'], 'Aerodynamics', 'AE301', 5, 'Incompressible and compressible flows, airfoils, and shock waves'],
    [deptMap['AE'], 'Aircraft Propulsion', 'AE302', 6, 'Gas turbine cycles, turbojets, turbofans, and rocket propulsion'],
    [deptMap['AE'], 'Flight Mechanics & Stability', 'AE303', 5, 'Equations of motion, static and dynamic aircraft stability, and control'],

    // BME
    [deptMap['BME'], 'Biomedical Instrumentation', 'BM301', 5, 'Bio-potential electrodes, ECG, EEG, and patient monitoring sensors'],
    [deptMap['BME'], 'Medical Imaging Systems', 'BM302', 6, 'X-Ray, CT scan, MRI, ultrasound principles, and image reconstruction'],
    [deptMap['BME'], 'Biomaterials & Implants', 'BM303', 4, 'Biocompatibility, metallic and polymer implants, and tissue interaction'],

    // BT
    [deptMap['BT'], 'Molecular Biology & Genetics', 'BT301', 4, 'DNA replication, transcription, translation, and gene regulation'],
    [deptMap['BT'], 'Bioprocess Engineering', 'BT302', 5, 'Fermentation technology, bioreactor design, and downstream processing'],
    [deptMap['BT'], 'Genetic Engineering & Recombinant DNA', 'BT303', 6, 'Cloning vectors, PCR, CRISPR gene editing, and transgenic organisms'],

    // AI&DS
    [deptMap['AI&DS'], 'Machine Learning Foundations', 'AD301', 5, 'Supervised/unsupervised learning, regression, classification, and trees'],
    [deptMap['AI&DS'], 'Deep Learning & Neural Networks', 'AD302', 6, 'CNN, RNN, Transformers, backpropagation, and PyTorch implementations'],
    [deptMap['AI&DS'], 'Natural Language Processing', 'AD303', 6, 'Tokenization, word embeddings, attention mechanisms, and LLMs'],

    // RAE
    [deptMap['RAE'], 'Kinematics & Dynamics of Robots', 'RA301', 5, 'Homogeneous transformations, DH parameters, forward and inverse kinematics'],
    [deptMap['RAE'], 'Sensors & Actuators in Automation', 'RA302', 4, 'Encoders, vision sensors, servo motors, and pneumatic systems'],
    [deptMap['RAE'], 'Industrial Automation & PLC', 'RA303', 6, 'Ladder logic programming, SCADA systems, and flexible manufacturing cells'],

    // AME
    [deptMap['AME'], 'Automotive Chassis & Transmission', 'AM301', 5, 'Clutch, gearbox, differential, steering, and braking systems'],
    [deptMap['AME'], 'Internal Combustion Engines', 'AM302', 4, 'SI and CI engine cycles, fuel injection, turbocharging, and emissions'],
    [deptMap['AME'], 'Electric & Hybrid Vehicles', 'AM303', 6, 'Battery management systems, traction motors, and regenerative braking'],

    // ENV
    [deptMap['ENV'], 'Water Supply & Wastewater Engineering', 'EV301', 5, 'Water treatment plant design, sedimentation, filtration, and disinfection'],
    [deptMap['ENV'], 'Air Pollution Monitoring & Control', 'EV302', 5, 'Particulate control, cyclones, electrostatic precipitators, and emission dispersion'],

    // MME
    [deptMap['MME'], 'Physical Metallurgy', 'MM301', 4, 'Iron-carbon equilibrium diagram, phase transformations, and heat treatment'],
    [deptMap['MME'], 'Mechanical Behaviour of Materials', 'MM302', 5, 'Stress-strain relations, dislocation theory, fatigue, and creep'],

    // IPE
    [deptMap['IPE'], 'Operations Research & Optimization', 'IP301', 5, 'Linear programming, simplex method, transportation, and queuing models'],
    [deptMap['IPE'], 'Supply Chain & Logistics Management', 'IP302', 6, 'Inventory management, EOQ models, warehousing, and logistics strategy'],

    // AGR
    [deptMap['AGR'], 'Farm Machinery & Power Engineering', 'AG301', 5, 'Tractor mechanics, tillage equipment, harvesting and threshing machinery'],
    [deptMap['AGR'], 'Soil & Water Conservation Engineering', 'AG302', 4, 'Watershed management, runoff estimation, and soil erosion control structures'],

    // MRNE
    [deptMap['MRNE'], 'Marine Propulsion Plants & Engines', 'MR301', 5, 'Two-stroke marine diesels, shafting, propellers, and engine room systems'],
    [deptMap['MRNE'], 'Ship Construction & Naval Architecture', 'MR302', 5, 'Ship geometry, buoyancy, stability, and structural framing']
  ];

  for (const c of allCourses) {
    if (c[0]) insertCourse.run(...c);
  }

  // Ensure default demo users exist
  const hash = bcrypt.hashSync(process.env.COURSEVAULT_DEMO_PASSWORD || 'CourseVault123!', 12);
  const insUser = db.prepare('INSERT OR IGNORE INTO users(name,email,password_hash,role,department_id,semester) VALUES (?,?,?,?,?,?)');

  const cseId = deptMap['CSE'] || 1;
  const eceId = deptMap['ECE'] || 2;

  insUser.run('Sana Kumar', 'student@coursevault.local', hash, 'Student', cseId, 5);
  insUser.run('Dr. Maya Chen', 'staff@coursevault.local', hash, 'Staff', cseId, null);
  insUser.run('Prof. Rajesh Sharma', 'rajesh.staff@coursevault.local', hash, 'Staff', eceId, null);
  insUser.run('CourseVault Admin', 'admin@coursevault.local', hash, 'Admin', null, null);

  const studentUser = db.prepare('SELECT id FROM users WHERE email=?').get('student@coursevault.local');
  const staffUser = db.prepare('SELECT id FROM users WHERE email=?').get('staff@coursevault.local');

  if (studentUser) {
    db.prepare('INSERT OR IGNORE INTO notification_preferences(user_id,messages,resource_updates,ratings) VALUES (?,?,?,?)').run(studentUser.id, 1, 1, 1);
  }
  if (staffUser) {
    db.prepare('INSERT OR IGNORE INTO notification_preferences(user_id,messages,resource_updates,ratings) VALUES (?,?,?,?)').run(staffUser.id, 1, 1, 1);
  }

  // Sample study materials
  const resCount = db.prepare('SELECT COUNT(*) n FROM resources').get().n;
  if (resCount < 10 && staffUser) {
    const insertRes = db.prepare(`
      INSERT INTO resources(title,subject,description,content,unit,department_id,course_id,semester,type,external_url,uploader_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `);

    const courseByName = name => db.prepare('SELECT id, department_id, semester FROM courses WHERE name=?').get(name);

    const sampleMaterials = [
      ['Operating Systems — Process Synchronization', 'Operating Systems', 'Semaphores, mutexes, and classic synchronization problems.', 'process synchronization semaphores mutex critical section deadlock race condition', 'Unit 3 · Processes & Threads', 'Notes', null],
      ['Dynamic Programming: Patterns & Practice', 'Design & Analysis of Algorithms', 'A worked introduction to dynamic programming with memoization.', 'algorithms dynamic programming optimization memoization bellman knapsack', 'Unit 4 · Dynamic Programming', 'Video', 'https://www.youtube.com/watch?v=oBt53YbR9Kk'],
      ['Boolean Algebra & Logic Gates — Past Questions', 'Discrete Mathematics', 'Past questions on Boolean logic, simplification, and set operations.', 'boolean logic sets algebra propositions karnaugh map', 'Unit 2 · Boolean Logic', 'Question paper', null],
      ['Database Normalization & SQL Queries', 'Database Management Systems', 'Normalization forms (1NF, 2NF, 3NF, BCNF) and sample SQL exercises.', 'sql normalization database relational schema bcnf queries join', 'Unit 3 · Relational Design', 'Notes', null],
      ['Computer Networks — Routing & Switching', 'Computer Networks', 'Network-layer routing algorithms (Dijkstra, Bellman-Ford) and switching.', 'routing network tcp ip switching subnetting packet forwarding', 'Unit 5 · Network Layer', 'Slides', null],
      ['Graph Algorithms: BFS, DFS & Shortest Paths', 'Data Structures & Algorithms', 'Lab exercises and code examples for common graph traversals.', 'graphs bfs dfs shortest path dijkstra adjacency list', 'Unit 2 · Graphs', 'Lab material', null],
      ['Cloud Computing Architecture & Microservices', 'Cloud Computing Architecture', 'Containerization, Kubernetes orchestration, and cloud service models (IaaS, PaaS, SaaS).', 'cloud virtualization microservices kubernetes docker containers iaas paas', 'Unit 2 · Microservices', 'Notes', null],
      ['Digital Signal Processing & Filter Design', 'Signals and Systems', 'FIR and IIR filter design, Z-transform analysis, and Fourier transforms.', 'signals fourier filter z-transform sampling convolution frequency response', 'Unit 3 · Filters', 'Notes', null],
      ['Engineering Thermodynamics — Cycles & Entropy', 'Engineering Thermodynamics', 'Carnot, Rankine, and Otto cycles with solved entropy numericals.', 'thermodynamics carnot entropy heat engine rankine otto cycle work', 'Unit 4 · Power Cycles', 'Notes', null],
      ['Machine Learning Foundations & Supervised Models', 'Machine Learning Foundations', 'Regression, decision trees, random forests, and evaluation metrics.', 'machine learning regression decision trees classification gradient descent precision recall', 'Unit 1 · Supervised Learning', 'Notes', null],
      ['Robotics Kinematics — DH Parameters & Forward Kinematics', 'Kinematics & Dynamics of Robots', 'Denavit-Hartenberg representation and forward position kinematics for robotic manipulators.', 'robotics kinematics dh parameters degrees of freedom transformation matrix manipulator', 'Unit 2 · Spatial Descriptions', 'Notes', null]
    ];

    for (const s of sampleMaterials) {
      const co = courseByName(s[1]);
      if (co) {
        const rId = insertRes.run(s[0], s[1], s[2], s[3], s[4], co.department_id, co.id, co.semester, s[5], s[6], staffUser.id).lastInsertRowid;
        if (studentUser) {
          db.prepare('INSERT OR IGNORE INTO ratings(resource_id,student_id,value) VALUES (?,?,?)').run(rId, studentUser.id, 5);
        }
      }
    }
  }

  // Seed sample student queries if none exist
  const queryCount = db.prepare('SELECT COUNT(*) n FROM student_queries').get().n;
  if (queryCount === 0 && studentUser && staffUser) {
    const osCourse = db.prepare("SELECT id FROM courses WHERE name='Operating Systems'").get();
    const dbmsCourse = db.prepare("SELECT id FROM courses WHERE name='Database Management Systems'").get();

    db.prepare(`
      INSERT INTO student_queries (student_id, department_id, course_id, topic, question, reply, replied_by, status, replied_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'answered', CURRENT_TIMESTAMP)
    `).run(
      studentUser.id,
      cseId,
      osCourse ? osCourse.id : null,
      'Difference between Binary Semaphore and Mutex',
      'Can you clarify whether a binary semaphore can be used as a mutex lock, and who can release the lock in both cases?',
      'Great question Sana! While both have values 0 and 1, a Mutex includes ownership: only the process that acquired the lock can release it. A binary semaphore has no ownership and can be signaled (unlocked) by any process.',
      staffUser.id
    );

    db.prepare(`
      INSERT INTO student_queries (student_id, department_id, course_id, topic, question, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(
      studentUser.id,
      cseId,
      dbmsCourse ? dbmsCourse.id : null,
      'BCNF vs 3NF Decomposition in Practice',
      'When decomposing a table to BCNF, what should we do if dependency preservation is lost? Is 3NF preferred in real-world databases?'
    );
  }

  // Seed sample chat message if none exist
  const chatCount = db.prepare('SELECT COUNT(*) n FROM chat_messages').get().n;
  if (chatCount === 0 && studentUser && staffUser) {
    db.prepare(`
      INSERT INTO chat_messages (sender_id, recipient_id, message, read_at, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, datetime('now', '-2 hours'))
    `).run(studentUser.id, staffUser.id, 'Good evening Dr. Maya! Could you review my Unit 3 doubt on Peterson algorithm when you have time?');

    db.prepare(`
      INSERT INTO chat_messages (sender_id, recipient_id, message, read_at, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, datetime('now', '-1 hour'))
    `).run(staffUser.id, studentUser.id, 'Hello Sana, I checked your query and posted a detailed explanation. Let me know if you need any follow-up!');
  }
}

ensureSeed();

db.prepare(`UPDATE notification_preferences SET ratings=1 WHERE ratings=0 AND user_id IN (SELECT id FROM users WHERE role IN ('Staff','Admin'))`).run();
db.prepare(`DELETE FROM search_history WHERE created_at < datetime('now','-180 days')`).run();
db.prepare(`DELETE FROM activity_logs WHERE created_at < datetime('now','-365 days')`).run();
db.prepare(`DELETE FROM audit_logs WHERE created_at < datetime('now','-3 years')`).run();
db.prepare(`DELETE FROM notifications WHERE created_at < datetime('now','-365 days') AND read_at IS NOT NULL`).run();
db.prepare(`DELETE FROM reset_tokens WHERE expires_at < datetime('now','-7 days') OR used_at IS NOT NULL`).run();

export function logActivity(level, event, details = '') {
  db.prepare('INSERT INTO activity_logs(level,event,details) VALUES (?,?,?)').run(level, event, String(details).slice(0, 500));
}

export function audit(actor, action, type, id, details = '') {
  db.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)').run(actor || null, action, type, id || null, String(details).slice(0, 500));
}

export function getIndexDocuments() {
  return db.prepare(`SELECT id,title,subject,description,content,unit,type,course_id,department_id,semester,active,file_path,original_name,mime_type
    FROM resources WHERE active=1`).all();
}
