import { zintl } from "zintl/macro";
export const generateStaticParams = async () => {
  return ["en", "ar", "es", "zh"].map((locale) => ({ locale }));
};
export default async function AboutZintl({ params }: PageProps<"/[locale]/about-zintl">) {
  const { locale } = await params;
  await zintl(locale);

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black p-16">
      <h1 className="text-3xl font-semibold text-black dark:text-zinc-50">
        About Zintl Translation System
      </h1>
      <p className="mt-4 max-w-md text-lg text-zinc-600 dark:text-zinc-400">
        Zintl is a compiler-driven internationalization system for modern web applications.
      </p>
      <div className="mt-8 p-4 bg-zinc-100 dark:bg-zinc-900 rounded border border-zinc-200 dark:border-zinc-800">
        <p className="text-sm font-mono text-zinc-500">Current Locale: {locale}</p>
      </div>
    </div>
  );
}
