"use client";

import { useState, useEffect } from "react";
import GooglePlacesAutocomplete from "react-google-places-autocomplete";
import { CheckCircle2, Loader2, MapPin } from "lucide-react";
import toast from "react-hot-toast";
import { findOrCreateCity } from "@/lib/User/user/create-institute";

export interface SelectedCity {
  id: string;
  name: string;
  slug: string;
  state: string;
}

interface CityAutoCompleteProps {
  onCitySelect: (city: SelectedCity | null) => void;
  selectedCity?: SelectedCity | null;
  placeholder?: string;
}

function extractCityDetails(
  place: google.maps.places.PlaceResult,
  fallbackLabel: string
) {
  const components = place.address_components || [];

  const getComponent = (type: string) =>
    components.find((c) => c.types.includes(type))?.long_name;

  const locality = getComponent("locality");
  const adminLevel3 = getComponent("administrative_area_level_3");
  const adminLevel2 = getComponent("administrative_area_level_2");
  const state = getComponent("administrative_area_level_1") || "India";
  const country = getComponent("country") || "India";

  const labelCity = fallbackLabel.split(",")[0]?.trim();
  const cityName =
    locality || place.name || adminLevel3 || adminLevel2 || labelCity || "";

  const latitude = place.geometry?.location?.lat() ?? null;
  const longitude = place.geometry?.location?.lng() ?? null;

  return {
    name: cityName,
    state,
    country,
    latitude,
    longitude,
  };
}

export default function CityAutoComplete({
  onCitySelect,
  selectedCity,
  placeholder = "Search your city (e.g. Kota, Lucknow, Noida)...",
}: CityAutoCompleteProps) {
  const [value, setValue] = useState<any>(null);
  const [sessionToken, setSessionToken] = useState<any>(null);
  const [isGoogleReady, setIsGoogleReady] = useState(false);
  const [isSavingCity, setIsSavingCity] = useState(false);

  useEffect(() => {
    const checkGoogle = setInterval(() => {
      if (typeof window !== "undefined" && window.google?.maps?.places) {
        setIsGoogleReady(true);
        setSessionToken(
          new window.google.maps.places.AutocompleteSessionToken()
        );
        clearInterval(checkGoogle);
      }
    }, 100);

    return () => clearInterval(checkGoogle);
  }, []);

  const handleSelect = (selectedOption: any) => {
    setValue(selectedOption);

    if (!selectedOption) {
      onCitySelect(null);
      return;
    }

    if (selectedOption && window.google) {
      setIsSavingCity(true);
      const placesService = new google.maps.places.PlacesService(
        document.createElement("div")
      );

      placesService.getDetails(
        {
          placeId: selectedOption.value.place_id,
          fields: ["name", "address_components", "geometry", "formatted_address"],
          sessionToken,
        },
        async (place, status) => {
          try {
            if (
              status === google.maps.places.PlacesServiceStatus.OK &&
              place
            ) {
              const details = extractCityDetails(place, selectedOption.label);

              if (!details.name) {
                toast.error("Could not detect city name. Please try another.");
                onCitySelect(null);
                return;
              }

              const result = await findOrCreateCity(details);

              if (result.success && result.city) {
                onCitySelect(result.city);
                toast.success(
                  result.created
                    ? `${result.city.name}, ${result.city.state} added & selected!`
                    : `${result.city.name}, ${result.city.state} selected!`
                );
              } else {
                toast.error(result.error || "Failed to save selected city.");
                onCitySelect(null);
              }
            } else {
              toast.error("Could not fetch city details. Please try again.");
              onCitySelect(null);
            }
          } catch (err) {
            console.error("City selection error:", err);
            toast.error("Something went wrong while selecting city.");
            onCitySelect(null);
          } finally {
            setIsSavingCity(false);
            setSessionToken(
              new google.maps.places.AutocompleteSessionToken()
            );
          }
        }
      );
    }
  };

  if (!isGoogleReady) {
    return (
      <div className="w-full p-3 text-sm text-slate-500 bg-slate-50/70 rounded-xl border border-slate-200 animate-pulse flex items-center gap-2">
        <MapPin className="w-4 h-4 text-amber-500 shrink-0" />
        <span>Initializing City Search...</span>
      </div>
    );
  }

  return (
    <div className="w-full space-y-2">
      <div className="relative">
        <GooglePlacesAutocomplete
          apiOptions={{
            language: "en",
            region: "in",
          }}
          debounce={300}
          selectProps={{
            instanceId: "google-places-city-search",
            value,
            onChange: handleSelect,
            placeholder,
            isClearable: true,
            isDisabled: isSavingCity,
            components: {
              DropdownIndicator: null,
            },
            styles: {
              control: (provided, state) => ({
                ...provided,
                minHeight: "46px",
                borderRadius: "0.75rem",
                padding: "0.15rem 0.25rem",
                backgroundColor: state.isFocused ? "#ffffff" : "rgba(248, 250, 252, 0.5)",
                borderColor: state.isFocused ? "#f59e0b" : "#e2e8f0",
                boxShadow: state.isFocused ? "0 0 0 2px rgba(245, 158, 11, 0.25)" : "none",
                transition: "all 150ms ease-out",
                "&:hover": { borderColor: "#fbbf24" },
              }),
              menu: (provided) => ({
                ...provided,
                borderRadius: "1rem",
                marginTop: "0.5rem",
                padding: "0.4rem",
                backgroundColor: "rgba(255, 255, 255, 0.96)",
                backdropFilter: "blur(12px)",
                boxShadow:
                  "0 20px 35px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.06)",
                border: "1px solid #e2e8f0",
                zIndex: 9999,
              }),
              option: (provided, state) => ({
                ...provided,
                borderRadius: "0.625rem",
                padding: "0.65rem 0.9rem",
                backgroundColor: state.isFocused ? "#fffbeb" : "transparent",
                color: state.isFocused ? "#92400e" : "#334155",
                cursor: "pointer",
                margin: "0.15rem 0",
                fontWeight: state.isFocused ? "600" : "500",
                fontSize: "0.875rem",
                transition: "background-color 150ms ease-out",
              }),
              input: (provided) => ({
                ...provided,
                color: "#1e293b",
                fontSize: "0.875rem",
              }),
              singleValue: (provided) => ({
                ...provided,
                color: "#0f172a",
                fontWeight: "600",
                fontSize: "0.875rem",
              }),
              placeholder: (provided) => ({
                ...provided,
                color: "#94a3b8",
                fontSize: "0.875rem",
              }),
            },
          }}
          autocompletionRequest={{
            componentRestrictions: { country: "in" },
            types: ["(cities)"],
            sessionToken,
          } as any}
        />
      </div>

      {isSavingCity && (
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />
          <span>Syncing city with directory...</span>
        </div>
      )}

      {!isSavingCity && selectedCity && (
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span>
            {selectedCity.name}, {selectedCity.state}
          </span>
        </div>
      )}
    </div>
  );
}
