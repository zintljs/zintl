import { getLocale } from "zintl/macro";
import Link from "next/link";
import Image from "next/image";
const locales = [
  { id: "en", name: "English" },
  { id: "es", name: "Español" },
  { id: "zh", name: "中文" },
  { id: "ar", name: "العربية" },
];

export default function LocaleSwitcher() {
  const locale = getLocale() || "en";

  return (
    <section className="flex items-center justify-end h-14 max-h-full border-b border-foreground/20 ">
      <div className="flex flex-row gap-4 flex-wrap justify-end ">
        {locales.map((l) => (
          <Link
            key={l.id}
            href={`/${l.id}`}
            className={locale === l.id ? "opacity-60 cursor-default" : "underline"}
          >
            {l.name}
          </Link>
        ))}
      </div>
      <div className="flex items-center justify-center h-full w-14 border-foreground/20  border-s-2 ms-5">
        <Image
          className="w-5 h-5 text-foreground shrink-0 opacity-60 dark:invert"
          src="/languages.svg"
          alt="languages"
          width={16}
          height={16}
        />
      </div>
    </section>
  );
}
