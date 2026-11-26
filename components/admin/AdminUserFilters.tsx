"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Search, Tag, X, Sparkles } from "lucide-react"
import { POPULAR_STUDENT_TAGS } from "@/components/student/StudentTagInput"

export default function UserFilters() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const currentSearch = searchParams.get("search") || "";
    const currentRole = searchParams.get("role") || "";
    const currentTag = searchParams.get("tag") || "";

    const updateFilter = (key: string, value: string) => {
        const params = new URLSearchParams(searchParams.toString());
        if (value.trim()) params.set(key, value.trim());
        else params.delete(key);
        
        params.set("page", "1"); // Reset to page 1 on filter change
        router.push(`/af-ass-manage/users?${params.toString()}`);
    }

    const handleTagClick = (tag: string) => {
        if (currentTag.toLowerCase() === tag.toLowerCase()) {
            updateFilter("tag", "");
        } else {
            updateFilter("tag", tag);
        }
    }

    const clearAllFilters = () => {
        router.push("/af-ass-manage/users");
    }

    const hasActiveFilters = Boolean(currentSearch || currentRole || currentTag);

    return (
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm mb-6 space-y-3.5">
            {/* Top row: Search input, Student Tag filter, Role select, and Clear button */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
                {/* Search Input (Name or Email) */}
                <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                        type="text"
                        placeholder="Search users by name or email..."
                        defaultValue={currentSearch}
                        onBlur={(e) => updateFilter("search", e.target.value)} 
                        onKeyDown={(e) => e.key === 'Enter' && updateFilter("search", e.currentTarget.value)}
                        className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none transition-all"
                    />
                </div>

                {/* Student Tag Filter Input with Autocomplete */}
                <div className="w-full md:w-64 relative">
                    <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-500" />
                    <input 
                        type="text"
                        list="student-tags-suggestions"
                        placeholder="Filter by Tag (e.g. Guitar, UPSC)..."
                        defaultValue={currentTag}
                        key={currentTag}
                        onBlur={(e) => updateFilter("tag", e.target.value)} 
                        onKeyDown={(e) => e.key === 'Enter' && updateFilter("tag", e.currentTarget.value)}
                        className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none font-medium text-slate-700 placeholder:text-slate-400 transition-all"
                    />
                    {currentTag && (
                        <button
                            type="button"
                            onClick={() => updateFilter("tag", "")}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded-full hover:bg-slate-200 transition-colors"
                            title="Clear tag filter"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                    <datalist id="student-tags-suggestions">
                        {POPULAR_STUDENT_TAGS.map((t) => (
                            <option key={t} value={t} />
                        ))}
                    </datalist>
                </div>

                {/* Role Filter Dropdown */}
                <div className="w-full md:w-48">
                    <select 
                        value={currentRole}
                        onChange={(e) => updateFilter("role", e.target.value)}
                        className="w-full py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none font-medium text-slate-700 transition-all"
                    >
                        <option value="">All Roles</option>
                        <option value="USER">User (Students)</option>
                        <option value="CONTENT_WRITER">Content Writer</option>
                        <option value="INSTITUTE_MANAGER">Institute Manager</option>
                        <option value="ADMIN">Admin</option>
                    </select>
                </div>

                {/* Clear All Filters Button */}
                {hasActiveFilters && (
                    <button
                        type="button"
                        onClick={clearAllFilters}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl transition-colors whitespace-nowrap"
                    >
                        <X className="w-3.5 h-3.5" />
                        <span>Reset Filters</span>
                    </button>
                )}
            </div>

            {/* Bottom row: Popular student tag quick-filter pills */}
            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-bold text-slate-600 flex items-center gap-1 mr-1">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    Quick Student Tags:
                </span>
                {POPULAR_STUDENT_TAGS.slice(0, 10).map((t) => {
                    const isSelected = currentTag.toLowerCase() === t.toLowerCase();
                    return (
                        <button
                            key={t}
                            type="button"
                            onClick={() => handleTagClick(t)}
                            className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-all active:scale-95 ${
                                isSelected
                                    ? "bg-amber-500 text-white border-amber-600 shadow-xs"
                                    : "bg-slate-50 text-slate-600 border-slate-200/80 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-800"
                            }`}
                        >
                            #{t}
                        </button>
                    );
                })}
            </div>
        </div>
    )
}