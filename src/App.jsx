import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, setDoc, addDoc, updateDoc, deleteDoc, query, where, getDocs } from 'firebase/firestore';

// Define the core App component
const App = () => {
  // Use a ref to ensure Firebase is initialized only once
  const isFirebaseInitialized = useRef(false);

  // State variables for application data and UI state
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [userRole, setUserRole] = useState('teacher'); // Default role for demo
  const [studentRecords, setStudentRecords] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [newStudentName, setNewStudentName] = useState('');
  const [newSubjectName, setNewSubjectName] = useState('');
  const [gradeData, setGradeData] = useState({ subject: '', grade: '' });
  const [showNotification, setShowNotification] = useState({ visible: false, message: '' });

  // Use the provided global variables for Firebase configuration
  const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
  const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
  const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

  // Function to show a temporary notification message
  const showTempNotification = (message) => {
    setShowNotification({ visible: true, message });
    setTimeout(() => {
      setShowNotification({ visible: false, message: '' });
    }, 3000);
  };

  // Effect to initialize Firebase and set up the auth listener
  useEffect(() => {
    // Only run this effect once
    if (isFirebaseInitialized.current) return;
    isFirebaseInitialized.current = true;

    try {
      // Initialize Firebase app
      const app = initializeApp(firebaseConfig);
      const firestoreDb = getFirestore(app);
      const firebaseAuth = getAuth(app);
      setDb(firestoreDb);
      setAuth(firebaseAuth);

      // Listen for auth state changes
      const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
        if (user) {
          setUserId(user.uid);
          // Set up a listener for user data to determine role
          const userDocRef = doc(firestoreDb, `/artifacts/${appId}/public/data/users/${user.uid}`);
          onSnapshot(userDocRef, (docSnap) => {
            if (docSnap.exists()) {
              const userData = docSnap.data();
              setUserRole(userData.role);
              showTempNotification(`Signed in as a ${userData.role}.`);
            } else {
              // Create a default user doc if it doesn't exist (for demo purposes)
              const defaultRole = 'teacher'; // Set a default role
              setDoc(userDocRef, { role: defaultRole, uid: user.uid });
              setUserRole(defaultRole);
            }
          });
        } else {
          // If no user is signed in, sign in with the custom token or anonymously
          try {
            if (initialAuthToken) {
              await signInWithCustomToken(firebaseAuth, initialAuthToken);
            } else {
              await signInAnonymously(firebaseAuth);
            }
          } catch (error) {
            console.error("Error signing in:", error);
            showTempNotification("Failed to sign in. Check the console for details.");
            setIsLoading(false); // Stop loading if sign-in fails
          }
        }
      });

      return () => unsubscribe();
    } catch (e) {
      console.error("Firebase Initialization Error:", e);
      showTempNotification("Error initializing the app. Check the console.");
      setIsLoading(false);
    }
  }, []);

  // Effect to fetch initial data based on user role and auth state
  useEffect(() => {
    if (!db || !userId) return;

    // Set up real-time listener for subjects
    const subjectsQuery = collection(db, `/artifacts/${appId}/public/data/subjects`);
    const unsubscribeSubjects = onSnapshot(subjectsQuery, (snapshot) => {
      const subjectsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSubjects(subjectsData);
      setIsLoading(false);
    });

    // Set up real-time listener for student records
    const recordsQuery = collection(db, `/artifacts/${appId}/public/data/records`);
    const unsubscribeRecords = onSnapshot(recordsQuery, (snapshot) => {
      const recordsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setStudentRecords(recordsData);
      setIsLoading(false);
    });

    return () => {
      unsubscribeSubjects();
      unsubscribeRecords();
    };
  }, [db, userId, appId]);

  // Handler for adding a new student
  const handleAddStudent = async (e) => {
    e.preventDefault();
    if (!newStudentName.trim() || !db) return;

    try {
      const studentId = crypto.randomUUID(); // Generate a unique ID
      const newStudentRef = doc(db, `/artifacts/${appId}/public/data/records/${studentId}`);
      await setDoc(newStudentRef, {
        studentId,
        studentName: newStudentName,
        grades: {}, // Initialize with an empty grades object
        createdBy: userId, // Track who created the record
      });
      setNewStudentName('');
      showTempNotification(`Added new student: ${newStudentName}`);
    } catch (e) {
      console.error("Error adding student:", e);
      showTempNotification("Failed to add student. Please try again.");
    }
  };

  // Handler for adding a new subject
  const handleAddSubject = async (e) => {
    e.preventDefault();
    if (!newSubjectName.trim() || !db) return;
    try {
      const subjectDocRef = doc(db, `/artifacts/${appId}/public/data/subjects/${newSubjectName.toLowerCase().replace(/\s/g, '-')}`);
      await setDoc(subjectDocRef, { name: newSubjectName });
      setNewSubjectName('');
      showTempNotification(`Added new subject: ${newSubjectName}`);
    } catch (e) {
      console.error("Error adding subject:", e);
      showTempNotification("Failed to add subject. Please try again.");
    }
  };

  // Handler for adding a new grade
  const handleAddGrade = async (e) => {
    e.preventDefault();
    if (!selectedStudentId || !gradeData.subject || !gradeData.grade || !db) return;

    const gradeValue = parseFloat(gradeData.grade);
    if (isNaN(gradeValue)) {
      showTempNotification("Invalid grade. Please enter a number.");
      return;
    }

    try {
      const studentRef = doc(db, `/artifacts/${appId}/public/data/records/${selectedStudentId}`);
      const studentDoc = studentRecords.find(s => s.studentId === selectedStudentId);

      const existingGrades = studentDoc?.grades?.[gradeData.subject] || [];
      const updatedGrades = [...existingGrades, gradeValue];

      // Use updateDoc to add the new grade to the specific subject array
      await updateDoc(studentRef, {
        [`grades.${gradeData.subject}`]: updatedGrades,
      });

      setGradeData({ subject: '', grade: '' });
      showTempNotification(`Added grade for ${studentDoc.studentName} in ${gradeData.subject}.`);
    } catch (e) {
      console.error("Error adding grade:", e);
      showTempNotification("Failed to add grade. Please try again.");
    }
  };

  // Function to calculate the average grade for a subject
  const calculateAverage = (grades) => {
    if (!grades || grades.length === 0) return 'N/A';
    const sum = grades.reduce((acc, curr) => acc + curr, 0);
    return (sum / grades.length).toFixed(2);
  };

  // Render the different views based on the user's role
  const renderDashboard = () => {
    if (isLoading) {
      return (
        <div className="flex justify-center items-center h-full">
          <svg className="animate-spin h-8 w-8 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="ml-2 text-gray-600">Loading...</span>
        </div>
      );
    }

    // Role-based rendering
    switch (userRole) {
      case 'teacher':
        return (
          <TeacherDashboard
            studentRecords={studentRecords}
            subjects={subjects}
            handleAddStudent={handleAddStudent}
            handleAddSubject={handleAddSubject}
            handleAddGrade={handleAddGrade}
            setNewStudentName={setNewStudentName}
            setNewSubjectName={setNewSubjectName}
            setGradeData={setGradeData}
            setSelectedStudentId={setSelectedStudentId}
            newStudentName={newStudentName}
            newSubjectName={newSubjectName}
            selectedStudentId={selectedStudentId}
            gradeData={gradeData}
            calculateAverage={calculateAverage}
          />
        );
      case 'student':
        // Find the current student's record
        const studentRecord = studentRecords.find(record => record.studentId === userId);
        return <StudentDashboard studentRecord={studentRecord} calculateAverage={calculateAverage} />;
      case 'parent':
        // Find the child's record (assuming parentId links to studentId for this demo)
        const childRecord = studentRecords.find(record => record.parentId === userId);
        return <ParentDashboard childRecord={childRecord} calculateAverage={calculateAverage} />;
      default:
        return (
          <div className="text-center p-8">
            <h2 className="text-xl font-bold mb-4">Welcome to the Academic Records System</h2>
            <p>Your user role is not recognized. Please contact an administrator.</p>
          </div>
        );
    }
  };

  // Simple UI for changing the role for demonstration purposes
  const RoleSelector = () => (
    <div className="flex space-x-2 bg-white rounded-full p-1 shadow-md mb-6">
      <button onClick={() => setUserRole('teacher')} className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${userRole === 'teacher' ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}>Teacher View</button>
      <button onClick={() => setUserRole('student')} className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${userRole === 'student' ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}>Student View</button>
      <button onClick={() => setUserRole('parent')} className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${userRole === 'parent' ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}>Parent View</button>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100 font-sans antialiased text-gray-800 p-4 sm:p-8 flex flex-col items-center">
      {/* App Header */}
      <div className="w-full max-w-5xl text-center mb-6">
        <h1 className="text-4xl font-extrabold text-indigo-600 mb-2">Digital Academic Records System</h1>
        <p className="text-lg text-gray-600">A modern solution for managing student performance.</p>
        <div className="mt-4">
          <span className="text-sm text-gray-500">
            Authenticated User ID: <span className="font-mono bg-gray-200 rounded-md px-2 py-1">{userId}</span>
          </span>
        </div>
      </div>
      
      {/* Role Selector and Main Dashboard */}
      <RoleSelector />
      
      <div className="w-full max-w-5xl bg-white rounded-lg shadow-xl p-6 sm:p-8">
        {renderDashboard()}
      </div>

      {/* Notification Toast */}
      {showNotification.visible && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg transition-opacity duration-300 opacity-90 z-50">
          {showNotification.message}
        </div>
      )}
    </div>
  );
};

// Teacher Dashboard Component (inside the main file)
const TeacherDashboard = ({
  studentRecords, subjects, handleAddStudent, handleAddSubject, handleAddGrade,
  setNewStudentName, setNewSubjectName, setGradeData, setSelectedStudentId,
  newStudentName, newSubjectName, selectedStudentId, gradeData, calculateAverage
}) => (
  <div className="space-y-8">
    <div className="grid md:grid-cols-2 gap-6">
      {/* Add New Student Form */}
      <div className="p-6 bg-indigo-50 rounded-xl shadow-inner">
        <h3 className="text-xl font-bold text-indigo-700 mb-4">Manage Students</h3>
        <form onSubmit={handleAddStudent} className="space-y-4">
          <input
            type="text"
            placeholder="Student Name"
            value={newStudentName}
            onChange={(e) => setNewStudentName(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition"
          />
          <button type="submit" className="w-full bg-indigo-600 text-white font-semibold py-2 rounded-lg shadow-md hover:bg-indigo-700 transition-colors">
            Add Student
          </button>
        </form>
      </div>

      {/* Add New Subject Form */}
      <div className="p-6 bg-indigo-50 rounded-xl shadow-inner">
        <h3 className="text-xl font-bold text-indigo-700 mb-4">Manage Subjects</h3>
        <form onSubmit={handleAddSubject} className="space-y-4">
          <input
            type="text"
            placeholder="Subject Name"
            value={newSubjectName}
            onChange={(e) => setNewSubjectName(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition"
          />
          <button type="submit" className="w-full bg-indigo-600 text-white font-semibold py-2 rounded-lg shadow-md hover:bg-indigo-700 transition-colors">
            Add Subject
          </button>
        </form>
      </div>
    </div>
    
    {/* Grade Entry Form */}
    <div className="p-6 bg-white rounded-xl shadow-md border border-gray-200">
      <h3 className="text-xl font-bold text-indigo-700 mb-4">Enter a New Grade</h3>
      <form onSubmit={handleAddGrade} className="space-y-4">
        <select
          value={selectedStudentId}
          onChange={(e) => setSelectedStudentId(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition"
        >
          <option value="">Select a Student</option>
          {studentRecords.map(student => (
            <option key={student.studentId} value={student.studentId}>{student.studentName}</option>
          ))}
        </select>
        <div className="grid sm:grid-cols-2 gap-4">
          <select
            value={gradeData.subject}
            onChange={(e) => setGradeData({ ...gradeData, subject: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition"
          >
            <option value="">Select a Subject</option>
            {subjects.map(subject => (
              <option key={subject.id} value={subject.name}>{subject.name}</option>
            ))}
          </select>
          <input
            type="number"
            placeholder="Grade (e.g., 95)"
            value={gradeData.grade}
            onChange={(e) => setGradeData({ ...gradeData, grade: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition"
          />
        </div>
        <button type="submit" className="w-full bg-indigo-600 text-white font-semibold py-2 rounded-lg shadow-md hover:bg-indigo-700 transition-colors">
          Add Grade
        </button>
      </form>
    </div>

    {/* Student Records Table */}
    <div className="overflow-x-auto rounded-xl shadow-md border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Student Name</th>
            {subjects.map(subject => (
              <th key={subject.id} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{subject.name}</th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {studentRecords.length > 0 ? (
            studentRecords.map(student => (
              <tr key={student.studentId}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{student.studentName}</td>
                {subjects.map(subject => (
                  <td key={subject.id} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {calculateAverage(student.grades[subject.name])}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={subjects.length + 1} className="text-center py-8 text-gray-500">No student records found. Add a student to get started.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </div>
);

// Student Dashboard Component (inside the main file)
const StudentDashboard = ({ studentRecord, calculateAverage }) => {
  if (!studentRecord) {
    return (
      <div className="text-center p-8">
        <h2 className="text-2xl font-bold text-gray-700">Student Record Not Found</h2>
        <p className="mt-2 text-gray-500">Please make sure you are signed in with a valid student ID.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold text-indigo-600">Welcome, {studentRecord.studentName}!</h2>
      <p className="text-gray-600">Here are your academic results.  They are updated in real-time as your teachers enter new grades.</p>
      
      <div className="overflow-x-auto rounded-xl shadow-md border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Subject</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Recent Grades</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Average Grade</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {Object.keys(studentRecord.grades).length > 0 ? (
              Object.keys(studentRecord.grades).map(subject => (
                <tr key={subject}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{subject}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {studentRecord.grades[subject].map(g => g.toFixed(0)).join(', ')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-indigo-600">
                    {calculateAverage(studentRecord.grades[subject])}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="3" className="text-center py-8 text-gray-500">No grades have been entered for you yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Parent Dashboard Component (inside the main file)
const ParentDashboard = ({ childRecord, calculateAverage }) => {
  if (!childRecord) {
    return (
      <div className="text-center p-8">
        <h2 className="text-2xl font-bold text-gray-700">Child's Record Not Found</h2>
        <p className="mt-2 text-gray-500">Please make sure you are linked to your child's student ID.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold text-indigo-600">Welcome, Parent!</h2>
      <p className="text-gray-600">Here are the academic results for {childRecord.studentName}.</p>
      
      <div className="overflow-x-auto rounded-xl shadow-md border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Subject</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Recent Grades</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Average Grade</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {Object.keys(childRecord.grades).length > 0 ? (
              Object.keys(childRecord.grades).map(subject => (
                <tr key={subject}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{subject}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {childRecord.grades[subject].map(g => g.toFixed(0)).join(', ')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-indigo-600">
                    {calculateAverage(childRecord.grades[subject])}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="3" className="text-center py-8 text-gray-500">No grades have been entered for your child yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Main App export
export default App;
