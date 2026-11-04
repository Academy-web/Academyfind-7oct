"use client"

import Link from "next/link";
import { ArrowRight, MapPin, Star } from "lucide-react";
import { CldImage } from "next-cloudinary"
import Image from "next/image";

export interface InstituteCardProps {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  city: {
    name: string;
    slug: string;
  };
  averageRating?: number | null;
  reviewCount?: number | null;
  googleRating?: number | null; // Added
  googleReviewCount?: number | null; // Added
  website?: string | null;
  image?: string | null;
  distance?: string | null;
  category?: string;
}

export default function InstituteCard({
  id,
  slug,
  name,
  description,
  city,
  averageRating,
  reviewCount,
  googleRating,
  googleReviewCount,
  image,
  distance,
  category
}: InstituteCardProps) {

  const isCloudinaryImage = image?.includes("cloudinary.com");

  // Priority: googleRating > averageRating > null
  const displayRating = googleRating ?? averageRating;
  console.log(googleRating)
  const displayReviewCount = googleReviewCount ?? reviewCount ?? 0;

  const getFallBackImage = (category: string) => {
    if (!category)
      return "/no_image/coaching_inst.PNG";

    switch (category) {
      case "jee-coaching":
        return "/no_image/jee_neet.PNG"
      case "neet-coaching":
        return "/no_image/jee_neet.PNG"
      case "upsc-coaching":
        return "/no_image/upsc_ias.PNG"
      case "cuet-coaching":
        return "/no_image/jee_neet.PNG"
      case "class-1-tuition":
        return "/no_image/tution.PNG"
      case "class-2-tuition":
        return "/no_image/tution.PNG"
      case "class-3-tuition":
        return "/no_image/tution.PNG"
      case "class-4-tuition":
        return "/no_image/tution.PNG"
      case "class-5-tuition":
        return "/no_image/tution.PNG"
      case "class-6-tuition":
        return "/no_image/tution.PNG"
      case "class-7-tuition":
        return "/no_image/tution.PNG"
      case "class-8-tuition":
        return "/no_image/tution.PNG"
      case "class-9-tuition":
        return "/no_image/tution.PNG"
      case "class-10-tuition":
        return "/no_image/tution.PNG"
      case "class-11-tuition":
        return "/no_image/tution.PNG"
      case "class-12-tuition":
        return "/no_image/tution.PNG"
      case "online-tuition":
        return "/no_image/tution.PNG"
      case "home-tution":
        return "/no_image/tution.PNG"
      case "ssc-coaching":
        return "/no_image/bank_ssc.PNG"
      case "banking-coaching":
        return "/no_image/bank_ssc.PNG"
      case "coding-classes":
        return "/no_image/computer_it.PNG"
      case "web-development":
        return "/no_image/computer_it.PNG"
      case "software-testing":
        return "/no_image/computer_it.PNG"
      case "app-development":
        return "/no_image/computer_it.PNG"
      case "interview-preparation":
        return "/no_image/test_prep.PNG"
      case "english-speaking":
        return "/no_image/language.PNG"
      case "hindi-speaking":
        return "/no_image/language.PNG"
      case "french-classes":
        return "/no_image/language.PNG"
      case "german-classes":
        return "/no_image/language.PNG"
      case "spanish-classes":
        return "/no_image/language.PNG"
      case "japanese-classes":
        return "/no_image/language.PNG"
      case "korean-classes":
        return "/no_image/language.PNG"
      case "dance-classes":
        return "/no_image/dance.PNG"
      case "music-classes":
        return "/no_image/music.PNG"
      case "singing-classes":
        return "/no_image/music.PNG"
      case "guitar-classes":
        return "/no_image/music.PNG"
      case "piano-classes":
        return "/no_image/music.PNG"
      case "tabla-classes":
        return "/no_image/music.PNG"
      case "violin-classes":
        return "/no_image/music.PNG"
      case "drawing-painting":
        return "/no_image/art_craft.PNG"
      case "fine-arts":
        return "/no_image/art_craft.PNG"
      case "sketching":
        return "/no_image/art_craft.PNG"
      case "art-craft-classes":
        return "/no_image/art_craft.PNG"
      case "swimming-classes":
        return "/no_image/sports_fitness.PNG"
      case "cricket-academy":
        return "/no_image/sports_fitness.PNG"
      case "football-academy":
        return "/no_image/sports_fitness.PNG"
      case "basketball-academy":
        return "/no_image/sports_fitness.PNG"
      case "badminton-academy":
        return "/no_image/sports_fitness.PNG"
      case "tennis-academy":
        return "/no_image/sports_fitness.PNG"
      case "gymnastics":
        return "/no_image/sports_fitness.PNG"
      case "skating-classes":
        return "/no_image/sports_fitness.PNG"
      case "athletics":
        return "/no_image/sports_fitness.PNG"
      case "martial-arts":
        return "/no_image/sports_fitness.PNG"
      case "karate":
        return "/no_image/sports_fitness.PNG"
      case "taekwondo":
        return "/no_image/sport_fitness.PNG"
      case "yoga-classes":
        return "/no_image/yoga_welness.PNG"
      case "phonics":
        return "/no_image/kids.PNG"
      case "preschool-programs":
        return "/no_image/kids.PNG"
      case "handwriting-improvement":
        return "/no_image/kids.PNG"
      case "coding-for-kids":
        return "no_image/kids.PNG"
      case "abacus-classes":
        return "/no_image/abacus_math.PNG"
      case "vedic-maths":
        return "/no_image/abacus_math.PNG"
      default:
        return "/no_image/coaching_inst.PNG"

    }
  }

  return (
    <Link
      href={`/institute/${id}-${slug}`}
      prefetch={false}
      className="
        group
        block
        overflow-hidden
        rounded-2xl
        border
        border-white/50
        bg-white/70
        backdrop-blur-md
        transition-all
        duration-500
        hover:-translate-y-2
        hover:border-amber-200/60
        hover:shadow-[0_20px_40px_rgba(251,191,36,0.15)]
        hover:[transform:perspective(1000px)_rotateX(2deg)_rotateY(-2deg)]
      "
    >
      {/* Image */}
      <div className="relative h-52 overflow-hidden">
        {image && isCloudinaryImage ? (
          <CldImage
            unoptimized
            src={image}
            alt={name}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            className="
              object-cover
              transition-transform
              duration-500
              group-hover:scale-105
            "
          />
          // ) : image ? (
          //   <img 
          //     src={image} 
          //     alt={name} 
          //     className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          //   />
        ) : (
          <div className="flex h-full items-center justify-center bg-muted">
            <Image src={getFallBackImage(category || "")} alt="No Image" width={400} height={400} unoptimized />
          </div>
        )}

        {/* Rating */}
        {displayRating ? (
          <div
            className="
              absolute
              right-3
              top-3
              flex
              items-center
              gap-1
              rounded-full
              bg-background/90
              px-3
              py-1
              backdrop-blur
            "
          >
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
            <span className="text-sm font-medium">
              {displayRating.toFixed(1)}
            </span>
          </div>
        ) : null}
      </div>

      {/* Content */}
      {/* Content */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-2 text-lg font-semibold transition-colors group-hover:text-amber-500">
            {name}
          </h3>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-all group-hover:translate-x-1 group-hover:text-amber-500" />
        </div>

        {/* City aur Distance ka Row (Aamne-Samne) */}
        <div className="mt-3 flex items-center gap-2 justify-between">
          {/* City Chip */}
          <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-600">
            <MapPin className="h-3 w-3" />
            {city.name}
          </div>

          {/* Distance Chip */}
          {distance && (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-100 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
              <MapPin className="h-3 w-3 text-amber-500" />
              {distance} km away
            </div>
          )}
        </div>

        {/* Description (Ye alag se block mein rahega) */}
        {description && (
          <p className="mt-4 line-clamp-2 text-sm text-muted-foreground">
            {description}
          </p>
        )}

        {/* Footer */}
        <div className="mt-5 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{displayReviewCount} reviews</span>
          <span className="text-sm font-medium text-amber-500">View Profile</span>
        </div>
      </div>
    </Link>
  );
}