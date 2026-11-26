"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Search, Tag, X, Sparkles, FolderTree } from "lucide-react"
import { POPULAR_STUDENT_TAGS } from "@/components/student/StudentTagInput"

interface AdminCategoryOption {
    id: string;
    name: string;
    slug: string;
}

export default function UserFilters({
    categories = [],
}: {
    categories?: AdminCategoryOption[];
}) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const currentSearch = searchParams.get("search") || "";
    const currentRole = searchParams.get("role") || "";
    const currentTag = searchParams.get("tag") || "";
    const currentCategory = searchParams.get("category") || "";

    const updateFilter = (key: string, value: string) => {
        const params = new URLSearchParams(searchParams.toString());
        if (value.trim()) {
            params.set(key, value.trim());
            // If setting category, clear tag and vice-versa for clarity
            if (key === "category") params.delete("tag");
            if (key === "tag") params.delete("category");
        } else {
            params.delete(key);
        }
        
        params.set("page", "1"); // Reset to page 1 on filter change
        router.push(`/af-ass-manage/users?${params.toString()}`);
    }

    const handleQuickClick = (item: string) => {
        const active = currentCategory || currentTag;
        if (active.toLowerCase() === item.toLowerCase()) {
            const params = new URLSearchParams(searchParams.toString());
            params.delete("category");
            params.delete("tag");
            params.set("page", "1");
            router.push(`/af-ass-manage/users?${params.toString()}`);
        } else {
            updateFilter("category", item);
        }
    }

    const clearAllFilters = () => {
        router.push("/af-ass-manage/users");
    }

    const hasActiveFilters = Boolean(currentSearch || currentRole || currentTag || currentCategory);

    // Combine category names with popular presets
    const allSuggestions = Array.from(
        new Set([...categories.map((c) => c.name), ...POPULAR_STUDENT_TAGS])
    );

    return (
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm mb-6 space-y-3.5">
            {/* Top row: Search input, Category Dropdown, Student Tag filter, Role select, and Clear button */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Search Input (Name or Email) */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    <input 
                        type="text"
                        placeholder="Search name or email..."
                        defaultValue={currentSearch}
                        onBlur={(e) => updateFilter("search", e.target.value)} 
                        onKeyDown={(e) => e.key === 'Enter' && updateFilter("search", e.currentTarget.value)}
                        className="w-full pl-9 pr-4 py-2.5 min-h-[44px] bg-slate-50 border border-slate-200 rounded-xl text-base sm:text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none transition-all"
                    />
                </div>

                {/* Direct Category Dropdown */}
                <div className="relative">
                    <FolderTree className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-500 pointer-events-none z-10" />
                    <select 
                        value={currentCategory}
                        onChange={(e) => updateFilter("category", e.target.value)}
                        className="w-full min-h-[44px] py-2.5 pl-9 pr-8 bg-slate-50 border border-slate-200 rounded-xl text-base sm:text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none font-medium text-slate-800 transition-all cursor-pointer appearance-auto"
                    >
                        <option value="">All Coaching Categories</option>
                        {categories.map((c) => (
                            <option key={c.id} value={c.name}>
                                {c.name}
                            </option>
                        ))}
                    </select>
                    {currentCategory && (
                        <button
                            type="button"
                            onClick={() => updateFilter("category", "")}
                            className="absolute right-7 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-200 transition-colors z-10"
                            title="Clear category filter"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>

                {/* Student Tag Search Input with Autocomplete */}
                <div className="relative">
                    <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-500 pointer-events-none" />
                    <input 
                        type="text"
                        list="student-tags-suggestions"
                        placeholder="Tag (e.g. Guitar, UPSC)..."
                        defaultValue={currentTag}
                        key={currentTag}
                        onBlur={(e) => updateFilter("tag", e.target.value)} 
                        onKeyDown={(e) => e.key === 'Enter' && updateFilter("tag", e.currentTarget.value)}
                        className="w-full pl-9 pr-8 py-2.5 min-h-[44px] bg-slate-50 border border-slate-200 rounded-xl text-base sm:text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none font-medium text-slate-800 placeholder:text-slate-400 transition-all"
                    />
                    {currentTag && (
                        <button
                            type="button"
                            onClick={() => updateFilter("tag", "")}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-200 transition-colors"
                            title="Clear tag filter"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                    <datalist id="student-tags-suggestions">
                        {allSuggestions.map((t) => (
                            <option key={t} value={t} />
                        ))}
                    </datalist>
                </div>

                {/* Role Filter & Reset Button */}
                <div className="flex items-center gap-2">
                    <select 
                        value={currentRole}
                        onChange={(e) => updateFilter("role", e.target.value)}
                        className="flex-1 py-2.5 min-h-[44px] px-3 bg-slate-50 border border-slate-200 rounded-xl text-base sm:text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none font-medium text-slate-800 transition-all cursor-pointer"
                    >
                        <option value="">All Roles</option>
                        <option value="USER">User (Students)</option>
                        <option value="CONTENT_WRITER">Content Writer</option>
                        <option value="INSTITUTE_MANAGER">Institute Manager</option>
                        <option value="ADMIN">Admin</option>
                    </select>

                    {hasActiveFilters && (
                        <button
                            type="button"
                            onClick={clearAllFilters}
                            className="inline-flex items-center justify-center gap-1 px-3 py-2.5 min-h-[44px] text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl transition-colors whitespace-nowrap"
                            title="Reset all filters"
                        >
                            <X className="w-3.5 h-3.5" />
                            <span>Reset</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Bottom row: Category & student tag quick-filter pills */}
            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-bold text-slate-600 flex items-center gap-1 mr-1">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    Quick Categories:
                </span>
                {allSuggestions.slice(0, 12).map((t) => {
                    const active = (currentCategory || currentTag).toLowerCase();
                    const isSelected = active === t.toLowerCase();
                    return (
                        <button
                            key={t}
                            type="button"
                            onClick={() => handleQuickClick(t)}
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