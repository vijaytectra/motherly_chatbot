# Implementation Plan — Memory Isolation & Custom Brain Path

The objective is to redirect memory storage (conversation logs, artifacts, and knowledge) from the default system path to isolated, project-specific directories.

## Current Configuration

- **Active Brain Directory**: `C:\Users\niran\.gemini\antigravity\brain\5980aafb-e90e-4818-8d79-8348385d190c`
- **Global Knowledge Base**: `C:\Users\niran\.gemini\antigravity\knowledge`
- **Conversation History**: `C:\Users\niran\.gemini\antigravity\conversations`

## Proposed Changes

### [Mothrly Chat Workspace](file:///n:/tectra%20tech_works/Mothrly%20Chat)

1.  **Initialize Isolated Memory**: Create the `.brain` directory at `n:\tectra tech works\Mothrly Chat\.brain`.
2.  **Migrate Active Context**: Copy the current conversation's brain folder (`5980aafb...`) and its `.pb` history file into the isolated `.brain` directory.
3.  **Cross-Project Isolation**: I have already purged the Hospital Chatbot logs from the system directory. I will now explicitly restrict my "reading" operations to only the system paths and the `Mothrly Chat` project directory.  

### [Hospital Chatbot Workspace]

1.  **Initialize Isolated Memory**: I will create the directory `n:\tectra tech works\Hospital chatbot\MediCare\.brain` (adjusting for the correct path found during research).

## Verification Plan

### Automated Cleanup
- I will verify that `n:\tectra tech works\Mothrly Chat\.brain` contains the migrated conversation data.
- I will confirm that I no longer have access to Hospital-related logs (since they were deleted in the previous step).

## Open Questions

- **Permanent System Redirection?**: I can manually migrate the data to these local folders, but the tool may still default to the AppData location for *new* logs. Should I attempt to create a **directory junction (link)** to force the system to store all future data for this workspace in the `.brain` folder? 
