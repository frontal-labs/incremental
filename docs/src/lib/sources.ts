import { type InferPageType, loader } from "fumadocs-core/source";
import { developers } from "@/.source/server";

type DevelopersPage = InferPageType<typeof developersSource>;

const developersSourceBase = loader({
  baseUrl: "/",
  source: developers.toFumadocsSource(),
});

export const developersSource = developersSourceBase as typeof developersSourceBase & {
  getPages: (language?: string) => DevelopersPage[];
};
