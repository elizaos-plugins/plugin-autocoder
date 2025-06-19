declare module '@elizaos/plugin-research' {
    export interface ResearchProject {
        id: string;
        status: ResearchStatus;
        error?: string;
        findings: ResearchFinding[];
        sources: ResearchSource[];
        report?: {
            summary: string;
            content: string;
        };
    }

    export interface ResearchFinding {
        content: string;
        source: string | { title: string };
        confidence?: number;
        relevance?: number;
    }

    export interface ResearchSource {
        url?: string;
        title: string;
        metadata?: any;
    }

    export interface ResearchService {
        createResearchProject(query: string, options: ResearchOptions): Promise<ResearchProject>;
        getProject(id: string): Promise<ResearchProject | null>;
        performResearch(topic: string, options?: any): Promise<any>;
    }

    export interface ResearchOptions {
        domain: ResearchDomain;
        researchDepth: ResearchDepth;
        maxSearchResults: number;
        timeout: number;
        enableCitations?: boolean;
        searchProviders?: string[];
    }

    export enum ResearchDomain {
        COMPUTER_SCIENCE = 'COMPUTER_SCIENCE',
        ENGINEERING = 'ENGINEERING',
        ART_DESIGN = 'ART_DESIGN',
        TECHNICAL = 'TECHNICAL',
        BUSINESS = 'BUSINESS',
        ACADEMIC = 'ACADEMIC'
    }

    export enum ResearchDepth {
        SURFACE = 'SURFACE',
        MODERATE = 'MODERATE',
        DEEP = 'DEEP'
    }

    export enum ResearchStatus {
        PENDING = 'PENDING',
        IN_PROGRESS = 'IN_PROGRESS',
        COMPLETED = 'COMPLETED',
        FAILED = 'FAILED'
    }

    export interface ResearchPlugin {
        name: string;
        description: string;
        actions: any[];
        providers: any[];
    }

    export interface ResearchCapability {
        name: string;
        description: string;
    }
} 