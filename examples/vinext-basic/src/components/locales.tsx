"use client";

import Link from "next/link";
import Image from "next/image";
import { useSelectedLayoutSegments } from "next/navigation";

const locales = [
  { id: "en", name: "English" },
  { id: "es", name: "Español" },
  { id: "zh", name: "中文" },
  { id: "ar", name: "العربية" },
];

export default function LocaleSwitcher({ locale }: { locale: string }) {
  const segments = useSelectedLayoutSegments();

  const switchLocaleHref = (l: string) => {
    return `/${l}/${segments.join("/")}`;
  };

  return (
    <section className="flex flex-wrap items-center gap-3 max-h-full justify-center max-w-fit ">
      <div className="flex items-center justify-center h-full w-14 border-e ">
        <Image
          className="w-4 h-4 text-foreground shrink-0 opacity-60 dark:invert "
          src="/languages.svg"
          alt="languages"
          width={12}
          height={12}
        />
      </div>
      <p>languages</p>
      {locales.map((l) => (
        <Link
          key={l.id}
          href={switchLocaleHref(l.id)}
          prefetch={false}
          className={locale === l.id ? "opacity-60 cursor-default" : "underline"}
        >
          {l.name}
        </Link>
      ))}
    </section>
  );
}
