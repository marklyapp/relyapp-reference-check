export function parseLinkedInUrl(input: string): { isLinkedIn: boolean; slug: string | null; searchName: string } {
  // Check if the input is a LinkedIn URL
  const linkedinRegex = /^(?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/in\/([^\/\?#]+)(?:[\/\?#].*)?$/i;
  const match = input.match(linkedinRegex);
  
  if (match) {
    const slug = decodeURIComponent(match[1]);
    return {
      isLinkedIn: true,
      slug: slug,
      searchName: slug
    };
  }
  
  // If not a LinkedIn URL, treat as plain name
  return {
    isLinkedIn: false,
    slug: null,
    searchName: input
  };
}
