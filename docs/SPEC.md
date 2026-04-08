# Reference Check App — Full Spec

## Context
This is a "Board Applicant Research Assistant" for the Government of Alberta. The Executive Council manually researches agency board applicants to assess political donations, social media activity, and other public information. This app automates that research using AI agents that interact with browser pages to gather applicant information and produce a text-based summary.

## Sample Report Format (Homer Simpson example)

The output report MUST follow this structure:

### Header
- Person name
- "background check"
- Location
- Recommendation: Proceed / Caution / Do Not Proceed

### NOTABLE ITEMS
Brief bullet points of key findings (e.g., "Grammy Winner, Astronaut, part-time snowplow operator", "Allegedly assaulted George H. W. Bush")

### PERSONAL INFORMATION
- Role/occupation description
- Demographics found

### DONATIONS
- Political donation search results (Elections AB, Elections Canada)

### SOCIAL MEDIA/ONLINE PRESENCE
For each platform (Facebook, Instagram, LinkedIn, Twitter/X, YouTube, Other):
- Personal account URL (or "None")
- Summary of content found
- Notable posts reference (link to Schedule)

### SCHEDULES (A, B, C, D, E...)
Each schedule corresponds to a platform and contains specific flagged posts with direct links:
- SCHEDULE A – Facebook (flagged posts with URLs)
- SCHEDULE B – Instagram (flagged posts with URLs)
- SCHEDULE C – LinkedIn
- SCHEDULE D – Twitter/X
- SCHEDULE E – Other

### SOURCES / CHECKLIST
A checklist of all sources searched, with checkmarks for completed searches:
- Professional Discipline (Law Society of Alberta, Real Estate License, etc.)
- Elections AB contributor search (quarterly, annual, leadership, nomination, third-party ads)
- Elections Canada donation database
- Google search with specific search term patterns
- LinkedIn (Resume Info, Top Interests, Posts, Comments, Reactions)
- Twitter (Tweets, Replies, Media, Following, Username)
- Facebook (Friends, Photos, About Info, Likes/Events, Posts, Username)
- Instagram (Posts and comments, Tagged Posts, Reels, Following, Username)
- YouTube
- CanLii (Canadian Legal Information Institute)

### Search Terms Used
Auto-generated search term combinations:
- Names: Various combinations with OR operators AND location
- Usernames
- Emails
- Phone Numbers
- Addresses
- Employer(s)
- Businesses Owned
- Volunteer/Religious Organizations
