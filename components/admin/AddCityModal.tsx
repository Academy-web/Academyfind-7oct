"use client";

import { useState } from "react";
import { createCity } from "@/lib/User/admin/adminCities";
import toast from "react-hot-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Save, MapPin, Loader2 } from "lucide-react";

const POPULAR_STATES = [
  "Andhra Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Delhi",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Tamil Nadu",
  "Telangana",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
];

export default function AddCityModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [cityName, setCityName] = useState("");
  const [selectedState, setSelectedState] = useState("");
  const [customState, setCustomState] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);
    if (selectedState === "CUSTOM") {
      formData.set("state", customState.trim());
    } else {
      formData.set("state", selectedState.trim());
    }

    const result = await createCity(formData);

    if (result.success) {
      toast.success(result.message || "City added successfully!");
      setIsOpen(false);
      setCityName("");
      setSelectedState("");
      setCustomState("");
    } else {
      toast.error(result.error || "Failed to add city");
    }
    setIsLoading(false);
  }

  const generatedSlug = cityName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {/* Trigger Button */}
      <DialogTrigger asChild>
        <button
          type="button"
          className="bg-amber-500 hover:bg-amber-600 text-stone-900 font-semibold px-4 py-2 rounded-xl text-sm flex items-center gap-2 transition shadow-sm hover:shadow active:scale-95 cursor-pointer"
        >
          <Plus className="w-4 h-4" /> Add City
        </button>
      </DialogTrigger>

      {/* Modal Content */}
      <DialogContent className="sm:max-w-lg p-6 bg-white border-stone-200 rounded-3xl shadow-2xl outline-none max-h-[90vh] overflow-y-auto">
        <DialogHeader className="mb-2">
          <DialogTitle className="text-xl font-bold text-stone-900 flex items-center gap-2">
            <div className="p-2 bg-amber-50 text-amber-600 rounded-xl">
              <MapPin className="w-5 h-5" />
            </div>
            Add Operational City
          </DialogTitle>
          <p className="text-xs text-stone-500 mt-1">
            Register a new city for coaching discovery, SEO landing pages, and geocoded institute mapping.
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* City Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-stone-700 uppercase tracking-wider">
              City Name <span className="text-amber-600">*</span>
            </label>
            <input
              type="text"
              name="name"
              required
              value={cityName}
              onChange={(e) => setCityName(e.target.value)}
              placeholder="e.g. Lucknow, Dehradun, Pune"
              className="w-full p-2.5 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:ring-2 focus:ring-amber-500 outline-none text-sm font-medium transition"
            />
          </div>

          {/* Slug Preview / Custom Slug */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-stone-700 uppercase tracking-wider">
              URL Slug <span className="text-stone-400 font-normal">(Auto-generated)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-stone-400">
                /directory/
              </span>
              <input
                type="text"
                name="slug"
                placeholder={generatedSlug || "lucknow"}
                defaultValue={generatedSlug}
                key={generatedSlug}
                className="w-full pl-24 pr-3 py-2.5 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:ring-2 focus:ring-amber-500 outline-none text-sm font-mono transition"
              />
            </div>
          </div>

          {/* State */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-stone-700 uppercase tracking-wider">
              State / UT <span className="text-amber-600">*</span>
            </label>
            <div className="space-y-2">
              <select
                required
                value={selectedState}
                onChange={(e) => setSelectedState(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:ring-2 focus:ring-amber-500 outline-none text-sm font-medium transition cursor-pointer"
              >
                <option value="">-- Select State --</option>
                {POPULAR_STATES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
                <option value="CUSTOM">+ Other State (Enter manually)</option>
              </select>

              {selectedState === "CUSTOM" && (
                <input
                  type="text"
                  required
                  value={customState}
                  onChange={(e) => setCustomState(e.target.value)}
                  placeholder="Enter state name"
                  className="w-full p-2.5 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:ring-2 focus:ring-amber-500 outline-none text-sm font-medium transition"
                />
              )}
            </div>
          </div>

          {/* Country */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-stone-700 uppercase tracking-wider">Country</label>
            <input
              type="text"
              name="country"
              defaultValue="India"
              className="w-full p-2.5 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:ring-2 focus:ring-amber-500 outline-none text-sm font-medium transition"
            />
          </div>

          {/* Coordinates (Optional) */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-stone-700 uppercase tracking-wider">
                Latitude <span className="text-stone-400 font-normal">(Optional)</span>
              </label>
              <input
                type="number"
                step="any"
                name="latitude"
                placeholder="e.g. 26.8467"
                className="w-full p-2.5 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:ring-2 focus:ring-amber-500 outline-none text-sm font-medium transition"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-stone-700 uppercase tracking-wider">
                Longitude <span className="text-stone-400 font-normal">(Optional)</span>
              </label>
              <input
                type="number"
                step="any"
                name="longitude"
                placeholder="e.g. 80.9462"
                className="w-full p-2.5 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:ring-2 focus:ring-amber-500 outline-none text-sm font-medium transition"
              />
            </div>
          </div>

          {/* Short Description */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-stone-700 uppercase tracking-wider">
              Description <span className="text-stone-400 font-normal">(Optional)</span>
            </label>
            <textarea
              name="description"
              rows={2}
              placeholder="e.g. Major education hub with prestigious IIT, coaching centers, and student hubs."
              className="w-full p-2.5 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:ring-2 focus:ring-amber-500 outline-none text-sm font-medium transition resize-none"
            />
          </div>

          {/* Footer Actions */}
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-stone-600 hover:bg-stone-100 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="bg-amber-500 hover:bg-amber-600 text-stone-900 px-5 py-2 rounded-xl font-bold flex items-center gap-2 transition disabled:opacity-50 shadow-sm hover:shadow"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" /> Save City
                </>
              )}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
