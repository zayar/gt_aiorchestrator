export const buildGtSummaryPrompt = (params: {
  title: string;
  highlights: string[];
}) => `
Rewrite the following clinic operations summary into concise, investor-demo-ready prose.

Title: ${params.title}
Highlights:
${params.highlights.map((entry) => `- ${entry}`).join("\n")}
`;
