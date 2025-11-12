'use client';


import { useMemo } from 'react';
import FilterPills from '@/app/components/ui/FilterPills';
import { useEmployeeRoleIndex } from '@/app/lib/employeeRoles';


/**
* EmployeeRolePills
*
* Props:
* - value: string ('all' | roleId)
* - onChange: (v: string) => void
* - includeAll: boolean (default true)
* - allLabel: string (default 'All')
*/
export default function EmployeeRolePills({ value, onChange, includeAll = true, allLabel = 'All' }) {
const { byId } = useEmployeeRoleIndex();


const options = useMemo(() => {
const empRoles = Object.values(byId).filter((r) => r?.isEmployee);
const opts = empRoles.map((r) => ({ value: r.id, label: r.name }));
return includeAll ? [{ value: 'all', label: allLabel }, ...opts] : opts;
}, [byId, includeAll, allLabel]);


return (
<FilterPills value={value} onChange={onChange} options={options} />
);
}