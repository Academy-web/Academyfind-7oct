"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Search } from "lucide-react"

export default function UserFilters() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const currentSearch = searchParams.get("search") || "";
    const currentRole = searchParams.get("role") || "";
    const currentTag = searchParams.get("tag") || "";

    const updateFilter = (key: string, value: string) => {
        const params = new URLSearchParams(searchParams.toString());
        if (value) params.set(key, value);
        else params.delete(key);
        
        params.set("page", "1"); // Filter change hone pe hamesha page 1 par jao
        router.push(`/af-ass-manage/users?${params.toString()}`);
    }

    return (
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 mb-6">
            {/* Search Input (Name or Email) */}
            <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                    type="text"
                    placeholder="Search by name or email..."
                    defaultValue={currentSearch}
                    onBlur={(e) => updateFilter("search", e.target.value)} 
                    onKeyDown={(e) => e.key === 'Enter' && updateFilter("search", e.currentTarget.value)}
                    className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
            </div>

            {/* Student Tag Filter */}
            <div className="w-full md:w-56 relative">
                <input 
                    type="text"
                    placeholder="Filter by Student Tag (e.g. Guitar, UPSC)..."
                    defaultValue={currentTag}
                    onBlur={(e) => updateFilter("tag", e.target.value)} 
                    onKeyDown={(e) => e.key === 'Enter' && updateFilter("tag", e.currentTarget.value)}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none font-medium text-slate-700 placeholder:text-slate-400"
                />
            </div>

            {/* Role Filter Dropdown */}
            <div className="w-full md:w-56">
                <select 
                    value={currentRole}
                    onChange={(e) => updateFilter("role", e.target.value)}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none font-medium text-slate-700"
                >
                    <option value="">All Roles</option>
                    <option value="USER">User (Students)</option>
                    <option value="CONTENT_WRITER">Content Writer</option>
                    <option value="INSTITUTE_MANAGER">Institute Manager</option>
                    <option value="ADMIN">Admin</option>
                </select>
            </div>
        </div>
    )
}