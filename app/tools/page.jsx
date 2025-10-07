'use client';

import { useState, useEffect } from 'react';
import { getFirestore, collection, getDocs, serverTimestamp, addDoc } from 'firebase/firestore';
import { app } from '../lib/firebase';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wrench,
  Plus,
  CheckSquare,
  RotateCcw,
  Search,
  Download,
  LayoutGrid,
  Table2
} from 'lucide-react';
import { saveAs } from 'file-saver';
import CornerUtilities from '../components/CornerUtilities';

export default function ToolsPage() {
  const db = getFirestore(app);
  const [tools, setTools] = useState([]);
  const [filteredTools, setFilteredTools] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('table');
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    const fetchTools = async () => {
      const querySnapshot = await getDocs(collection(db, 'tools'));
      const fetched = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTools(fetched);
      setFilteredTools(fetched);
    };
    fetchTools();
  }, []);

  useEffect(() => {
    if (searchTerm) {
      const filtered = tools.filter(t =>
        t.name?.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredTools(filtered);
    } else {
      setFilteredTools(tools);
    }
  }, [searchTerm, tools]);

  const exportCSV = () => {
    const header = ['Name', 'Checked Out', 'Returned'];
    const rows = filteredTools.map(t => [
      t.name,
      t.checkedOut || '',
      t.returned || ''
    ]);
    const csv = [header, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    saveAs(blob, 'tools.csv');
  };

const [materials, setMaterials] = useState([]);

useEffect(() => {
  const fetchMaterials = async () => {
    const querySnapshot = await getDocs(collection(db, 'materials'));
    const fetched = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    setMaterials(fetched);
  };
  fetchMaterials();
}, []);
function onClose() {
  setShowAddModal(false);
}

// Inside your AddToolModal or passed in from parent:
const handleSave = async (toolData) => {
  try {
    const dataToSave = {
      ...toolData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await addDoc(collection(db, 'tools'), dataToSave);

    console.log('Tool successfully saved!');
    onClose();  // Optional: close modal on success
  } catch (error) {
    console.error('Error saving tool:', error);
    // Optional: show error UI or toast
  }
};
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-white via-slate-100 to-white px-4 py-6 text-slate-900">
      <CornerUtilities />

      {/* Safelist hack */}
      <div className="hidden bg-blue-500 bg-green-500 bg-purple-500 bg-slate-900"></div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="relative z-10 backdrop-blur-md bg-white/40 border border-slate-200 rounded-[2rem] shadow-xl w-full max-w-[1600px] mx-auto mt-16 mb-16 p-8 flex flex-col min-h-[calc(100vh-12rem)]"
      >
        {/* Header */}
        <div className="flex flex-wrap justify-between items-center gap-2">
          <h1 className="text-3xl font-bold">Tools</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={exportCSV}
              className="backdrop-blur-md bg-white/70 hover:bg-white/80 border border-slate-300 rounded-[1rem] p-2 shadow-sm"
            >
              <Download className="w-5 h-5" />
            </button>
            <button
              onClick={() => setViewMode(viewMode === 'card' ? 'table' : 'card')}
              className="backdrop-blur-md bg-white/70 hover:bg-white/80 border border-slate-300 rounded-[1rem] p-2 shadow-sm"
            >
              {viewMode === 'card' ? <Table2 className="w-5 h-5" /> : <LayoutGrid className="w-5 h-5" />}
            </button>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search tools..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="pl-8 pr-3 py-1 rounded-full border border-slate-300 bg-white/80 text-sm"
              />
            </div>
            <button
              onClick={() => setShowAddModal(true)}
              className="backdrop-blur-md bg-blue-500 hover:bg-blue-600 text-white rounded-[1rem] p-2 shadow-sm"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Table view */}
        <div className="flex-1 overflow-y-auto mt-4">
          <div className="backdrop-blur-md bg-white/50 border border-slate-200 rounded-[2rem] shadow-xl overflow-x-auto p-4">
            <table className="w-full text-sm text-left text-slate-700">
              <thead>
                <tr>
                  <th className="px-2 py-1">Name</th>
                  <th className="px-2 py-1">Checked Out</th>
                  <th className="px-2 py-1">Returned</th>
                  <th className="px-2 py-1">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTools.map(t => (
                  <tr
                    key={t.id}
                    className="border-t border-slate-200 hover:bg-white/70 cursor-pointer"
                    style={{ minHeight: '52px' }}
                  >
                    <td className="px-2 py-1">{t.name}</td>
                    <td className="px-2 py-1">{t.checkedOut ? 'Yes' : 'No'}</td>
                    <td className="px-2 py-1">{t.returned ? 'Yes' : 'No'}</td>
                    <td className="px-2 py-1">
                      <div className="flex gap-2">
                        <ToolActionButton icon={CheckSquare} action="request" />
                        <ToolActionButton icon={RotateCcw} action="record" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </motion.div>

      {/* Add Tool Modal */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[2rem] shadow-xl p-6 w-full max-w-md"
            >
              <h2 className="text-xl font-bold mb-4">Add New Tool</h2>
              {/* Add your form fields here */}
              <button
                onClick={() => setShowAddModal(false)}
                className="mt-4 px-4 py-2 rounded-full bg-blue-500 text-white hover:bg-blue-600"
              >
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
 <AnimatePresence>
  {showAddModal && (
    <AddToolModal
  onClose={() => setShowAddModal(false)}
  onSave={handleSave}
  materialsOptions={materials}
/>

  )}
</AnimatePresence>


    </div>
  );
}

function AddToolModal({ onClose, onSave, materialsOptions = [] }) {
  const [id] = useState(() => String(Math.floor(Math.random() * 100000)).padStart(5, '0'));
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [category, setCategory] = useState('General');
  const [condition, setCondition] = useState('Brand New');
  const [description, setDescription] = useState('');
  const [isSet, setIsSet] = useState(false);
  const [totalItems, setTotalItems] = useState(1);
  const [checkedOut, setCheckedOut] = useState(false);
  const [returned, setReturned] = useState(true);
  const [subMaterial, setSubMaterial] = useState('');

  const handleLocalSave = () => {
    const toolData = {
      id,
      name,
      brand,
      model,
      category,
      condition,
      description,
      isSet,
      totalItems: isSet ? totalItems : 1,
      checkedOut,
      returned,
      subMaterial,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    onSave(toolData);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center"
    >
      <motion.div
  initial={{ scale: 0.95, opacity: 0 }}
  animate={{ scale: 1, opacity: 1 }}
  exit={{ scale: 0.95, opacity: 0 }}
  className="bg-white rounded-[2rem] shadow-xl p-6 w-[calc(100%-2rem)] max-w-[800px] overflow-y-auto max-h-[90vh]"
>
        <h2 className="text-xl font-semibold text-slate-800 mb-4">Add New Tool</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <InputField label="Tool ID" value={id} readOnly />
          <InputField label="Name" value={name} onChange={setName} />
          <InputField label="Brand" value={brand} onChange={setBrand} />
          <InputField label="Model" value={model} onChange={setModel} />
          <SelectField
            label="Category"
            value={category}
            onChange={setCategory}
            options={['General', 'Power Tools', 'Hand Tools', 'Measurement', 'Fasteners', 'Cutting', 'Other']}
          />
          <SelectField
            label="Condition"
            value={condition}
            onChange={setCondition}
            options={['Brand New', 'Like New', 'Used', 'Worn Out', 'Barely Functional', 'Useless']}
          />
          <div className="col-span-2">
            <InputField label="Description" value={description} onChange={setDescription} textarea />
          </div>

          <SelectField
            label="Is a Set?"
            value={isSet ? 'Yes' : 'No'}
            onChange={val => setIsSet(val === 'Yes')}
            options={['Yes', 'No']}
          />
          {isSet && (
            <InputField
              label="Total Items"
              value={totalItems}
              onChange={val => setTotalItems(Number(val))}
            />
          )}

          <SelectField
            label="Checked Out"
            value={checkedOut ? 'Yes' : 'No'}
            onChange={val => setCheckedOut(val === 'Yes')}
            options={['Yes', 'No']}
          />
          <SelectField
            label="Returned"
            value={returned ? 'Yes' : 'No'}
            onChange={val => setReturned(val === 'Yes')}
            options={['Yes', 'No']}
          />

          <div className="col-span-2">
            <SelectField
              label="Sub Material"
              value={subMaterial}
              onChange={setSubMaterial}
              options={materialsOptions.map(m => m.name)}
              placeholder="Select a material"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-full bg-slate-200 hover:bg-slate-300 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleLocalSave}
            className="px-4 py-2 rounded-full bg-blue-500 text-white hover:bg-blue-600 text-sm"
          >
            Save
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function NovaCheckbox({ label, checked, onChange }) {
  return (
    <label className="inline-flex items-center cursor-pointer gap-2">
      <div className="relative">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          className="peer hidden"
        />
        <div className="w-5 h-5 rounded-full border border-slate-400 peer-checked:bg-blue-500 peer-checked:border-blue-500"></div>
      </div>
      <span className="text-sm">{label}</span>
    </label>
  );
}
// Generic reusable InputField
function InputField({ label, value, onChange, readOnly = false, textarea = false }) {
  return (
    <div>
      <label className="block font-medium mb-1">{label}</label>
      {textarea ? (
        <textarea
          value={value}
          onChange={e => onChange?.(e.target.value)}
          readOnly={readOnly}
          className="w-full rounded-[1rem] border border-slate-300 bg-white/80 px-3 py-2 focus:outline-none shadow-sm"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange?.(e.target.value)}
          readOnly={readOnly}
          className={`w-full rounded-[1rem] border border-slate-300 ${
            readOnly ? 'bg-gray-100 text-slate-500' : 'bg-white/80'
          } px-3 py-2 focus:outline-none shadow-sm`}
        />
      )}
    </div>
  );
}

function SelectField({ label, value, onChange, options = [], placeholder = '' }) {
  return (
    <div>
      <label className="block font-medium mb-1">{label}</label>
      <select
        value={value}
        onChange={e => onChange?.(e.target.value)}
        className="w-full rounded-[1rem] border border-slate-300 bg-white/80 px-3 py-2 focus:outline-none shadow-sm"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(opt => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}

function ToolActionButton({ icon: Icon, action }) {
  const baseClass =
    'flex items-center justify-center p-2 rounded-[1rem] shadow-md hover:shadow-lg text-white transition';

  const colorMap = {
    request: 'bg-blue-500',
    record: 'bg-green-500'
  };

  const colorClass = colorMap[action] || 'bg-slate-900';

  return (
    <button
      className={`${baseClass} ${colorClass}`}
      style={{ minWidth: '36px', minHeight: '36px' }}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
