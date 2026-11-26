"use client";

import { useState } from "react";
import { createInstitute } from "@/lib/User/admin/adminMasterInstitute";
import { Button } from "@/components/ui/button";
import toast from "react-hot-toast";
import { Save, ArrowLeft, Image as ImageIcon, UploadCloud, MapPin } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import LocationAutocomplete from "../search/LocationAutoComplete";
import CityAutoComplete, { SelectedCity } from "../search/CityAutoComplete";

export default function AddInstituteForm({ 
    allCities, 
    allCategories 
}: { 
    allCities: any[]; 
    allCategories: any[];
}) {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);
    const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

    // Map/Location States
    const [selectedCity, setSelectedCity] = useState<SelectedCity | null>(null);
    const [address, setAddress] = useState("");
    const [lat, setLat] = useState<string>("");
    const [lng, setLng] = useState<string>("");

    const handlePlaceSelect = (lat: number, lng: number, formattedAddress: string) => {
        setAddress(formattedAddress);
        setLat(lat.toString());
        setLng(lng.toString());
        toast.success("Location auto-filled from Google Places!");
    };

    // Cloudinary Upload States
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string>("");
    const [isUploadingImage, setIsUploadingImage] = useState(false);

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            toast.error("Image too large. Max allowed limit is 5MB.");
            return;
        }

        setImageFile(file);
        setImagePreview(URL.createObjectURL(file)); 
    };

    const handleCategoryToggle = (categoryId: string) => {
        if (selectedCategories.includes(categoryId)) {
            setSelectedCategories(selectedCategories.filter(id => id !== categoryId));
        } else {
            setSelectedCategories([...selectedCategories, categoryId]);
        }
    };

    async function handleFormSubmit(formData: FormData) {
        if (!selectedCity?.id) {
            toast.error("Please search and select a city.");
            return;
        }

        setIsLoading(true);
         if (imageFile) {
            formData.append("imageFile", imageFile);
        }
        
        formData.set("cityId", selectedCity.id);
        formData.set("address", address);
        formData.set("latitude", lat);
        formData.set("longitude", lng);

        const result = await createInstitute(formData, selectedCategories);
        if (result.success) {
            toast.success(result.message || "Institute Created Successfully");
            router.push(`/af-ass-manage/institutes/${result.id}`); 
        } else {
            toast.error(result.error || "Can't create institute");
            setIsLoading(false);
        }
    }

    return (
        <form action={handleFormSubmit} className="space-y-8">
            
            {/* 1. Image Upload */}
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 space-y-4">
                <h3 className="font-bold text-slate-800 text-lg border-b pb-2 flex items-center gap-2">
                    <ImageIcon className="w-5 h-5 text-purple-600" /> Image
                </h3>
                <div className="flex flex-col items-center p-6 bg-white border border-slate-200 rounded-xl space-y-4">
                    <div className="w-full max-w-lg h-48 sm:h-64 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden relative">
                        {/* 🚀 FIX: Using imagePreview here instead of mainImageUrl */}
                        {imagePreview ? (
                            <img src={imagePreview} alt="Preview" className="w-full h-full object-cover absolute inset-0" />
                        ) : (
                            <div className="text-sm text-slate-400 flex flex-col items-center">
                                <ImageIcon className="w-8 h-8 mb-2"/> No Image
                            </div>
                        )}
                    </div>
                    <label className="cursor-pointer bg-slate-900 hover:bg-purple-700 text-white text-sm px-6 py-2.5 rounded-xl font-semibold transition-all">
                        {isUploadingImage ? "Uploading..." : "Upload Cover Image"}
                        <input type="file" accept="image/*" disabled={isUploadingImage} onChange={handleImageUpload} className="hidden" />
                    </label>
                </div>
            </div>

            {/* 2. Core & Location */}
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 space-y-4">
                <h3 className="font-bold text-slate-800 text-lg border-b pb-2 flex items-center gap-2">
                    <MapPin className="w-5 h-5 text-purple-600"/> Core Details & Google Places
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-sm font-semibold text-slate-700">Academy Name *</label>
                        <input type="text" name="name" required className="w-full p-2.5 rounded-xl border border-slate-200 bg-white" />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-semibold text-slate-700">City *</label>
                        <input type="hidden" name="cityId" value={selectedCity?.id || ""} />
                        <CityAutoComplete
                            selectedCity={selectedCity}
                            onCitySelect={setSelectedCity}
                        />
                    </div>
                </div>

                {/* GOOGLE PLACES INTEGRATION SPOT */}
                <div className="p-4 bg-purple-50 rounded-xl border border-purple-100 mt-4 space-y-4">
                    <p className="text-xs text-purple-800 font-bold mb-2">Search to auto-fill Address, Lat & Lng:</p>
                        <LocationAutocomplete 
                        onLocationSelect={handlePlaceSelect} 
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
                    <div className="md:col-span-3 space-y-2">
                        <label className="text-sm font-semibold text-slate-700">Address (Manual edit allowed) *</label>
                        <input type="text" value={address} onChange={(e)=>setAddress(e.target.value)} required className="w-full p-2.5 rounded-xl border border-slate-200 bg-white" />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500">Latitude</label>
                        <input type="number" step="any" value={lat} onChange={(e)=>setLat(e.target.value)} className="w-full p-2 border rounded-lg text-xs" />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500">Longitude</label>
                        <input type="number" step="any" value={lng} onChange={(e)=>setLng(e.target.value)} className="w-full p-2 border rounded-lg text-xs" />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500">Plan</label>
                        <select name="subscriptionPlan" className="w-full p-2 border rounded-lg text-xs font-bold text-purple-700">
                            <option value="BASIC">BASIC</option>
                            <option value="BASIC">Verified</option>
                            <option value="PREMIUM">PREMIUM</option>
                            <option value="ULTRA">ULTRA</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* 3. Categories */}
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 space-y-4">
                <h3 className="font-bold text-slate-800 text-lg border-b pb-2">3. Tagged Categories</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[250px] overflow-y-auto p-2 bg-white border rounded-xl">
                    {allCategories.map(category => {
                        const isChecked = selectedCategories.includes(category.id);
                        return (
                            <label key={category.id} className={`flex items-center gap-2 p-2 rounded-xl border text-xs cursor-pointer select-none transition-all ${isChecked ? "border-purple-300 bg-purple-50 text-purple-900 font-bold" : "bg-slate-50"}`}>
                                <input type="checkbox" checked={isChecked} onChange={() => handleCategoryToggle(category.id)} className="accent-purple-600 size-3.5" />
                                <span className="truncate">{category.name}</span>
                            </label>
                        )
                    })}
                </div>
            </div>

            {/* Submit */}
            <div className="flex justify-between border-t pt-6">
                <Link href="/af-ass-manage/institutes" className="text-sm font-semibold text-slate-500 flex items-center gap-2"><ArrowLeft className="w-4 h-4"/> Cancel</Link>
                <Button type="submit" disabled={isLoading || isUploadingImage} className="bg-purple-600 hover:bg-purple-700 text-white rounded-xl px-8 font-bold">
                    {isLoading ? "Creating..." : "Create Institute"}
                </Button>
            </div>
        </form>
    );
}