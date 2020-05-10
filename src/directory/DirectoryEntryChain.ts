import {Sectors} from "../Sectors";
import {Header} from "../Header";
import {StreamHolder} from "../stream/StreamHolder";
import {FAT} from "../alloc/FAT";
import {equal} from "../utils";
import {ObjectType, DirectoryEntry, ColorFlag} from "./DirectoryEntry";
import {StreamDirectoryEntry} from "./StreamDirectoryEntry";
import {StorageDirectoryEntry} from "./StorageDirectoryEntry";
import {RootStorageDirectoryEntry} from "./RootStorageDirectoryEntry";
import {CFDataview} from "../dataview/СFDataview";

export class DirectoryEntryChain {

    public static readonly UTF16_TERMINATING_BYTES = [255, 255];

    private readonly sectors: Sectors;
    private readonly fat: FAT;
    private readonly header: Header;
    private readonly sectorChain: number[];
    private readonly streamHolder: StreamHolder;
    private directoryEntryCount: number = 0;

    constructor(sectors: Sectors, fat: FAT, header: Header, streamHolder: StreamHolder) {
        this.sectors = sectors;
        this.fat = fat;
        this.header = header;
        this.sectorChain = fat.buildChain(header.getFirstDirectorySectorLocation());
        this.streamHolder = streamHolder;
        this.readDirectoryEntryCount();
    }

    private readDirectoryEntryCount(): void {
        if(this.sectorChain.length !== 0) {
            this.directoryEntryCount = (this.sectorChain.length - 1) * 4;
            const lastDirectoryEntrySector = this.sectors.sector(this.sectorChain[this.sectorChain.length - 1]);
            let directoriesInSector;
            for (directoriesInSector = 4; directoriesInSector > 0; directoriesInSector--) {
                const sectorStart = (directoriesInSector - 1) * 128;
                if(equal(DirectoryEntryChain.UTF16_TERMINATING_BYTES, lastDirectoryEntrySector.subView(sectorStart, sectorStart + 2).getData())) {
                    break;
                }
            }
            this.directoryEntryCount += directoriesInSector;
        }
    }

    public getRootStorage(): RootStorageDirectoryEntry {
        return this.getEntryById(0) as RootStorageDirectoryEntry;
    }

    getEntryById(i: number): DirectoryEntry {
        if(i < 0 || i > this.directoryEntryCount - 1) {
            throw new Error("No such element " + i);
        }
        const sectorNumber = Math.floor(i / 4);
        const shiftInsideSector = i % 4 * 128;
        const view = this.sectors.sector(this.sectorChain[sectorNumber]).subView(shiftInsideSector, shiftInsideSector + 128);
        const objectType = view.subView(DirectoryEntry.FLAG_POSITION.OBJECT_TYPE, DirectoryEntry.FLAG_POSITION.OBJECT_TYPE + 1).getData()[0] as ObjectType;
        if(objectType === ObjectType.RootStorage) {
            return new RootStorageDirectoryEntry(i, this, view) as DirectoryEntry;
        } else if(objectType === ObjectType.Storage) {
            return new StorageDirectoryEntry(i, this, view) as DirectoryEntry;
        } else {
            return new StreamDirectoryEntry(i, this, this.streamHolder, view) as DirectoryEntry;
        }
    }

    createRootStorage(): RootStorageDirectoryEntry {
        if(this.directoryEntryCount !== 0) {
            throw new Error("Root Storage should be the first Directory Entry");
        }
        const view = this.getViewForDirectoryEntry();
        return new RootStorageDirectoryEntry(0, this, view);
    }

    createStorage(name: string, colorFlag: ColorFlag): StorageDirectoryEntry {
        return new StorageDirectoryEntry(this.directoryEntryCount, this, this.getViewForDirectoryEntry(), name, colorFlag);
    }

    createStream(name: string, colorFlag: ColorFlag, data: number[]): StreamDirectoryEntry {
        const streamEntry = new StreamDirectoryEntry(this.directoryEntryCount, this, this.streamHolder, this.getViewForDirectoryEntry(), name, colorFlag);
        if(data.length > 0) {
            streamEntry.setStreamData(data);
        }
        return streamEntry;
    }

    private getViewForDirectoryEntry(): CFDataview {
        const directoriesRegisteredInCurrentSector = this.directoryEntryCount % 4;
        try {
            if (directoriesRegisteredInCurrentSector === 0) {
                const directoryEntrySector = this.sectors.allocate();
                if(this.sectorChain.length === 0) {
                    this.header.setFirstDirectorySectorLocation(directoryEntrySector.getPosition());
                    this.fat.registerSector(directoryEntrySector.getPosition(), null);
                } else {
                    this.fat.registerSector(directoryEntrySector.getPosition(), this.sectorChain[this.sectorChain.length - 1]);
                }
                this.sectorChain.push(directoryEntrySector.getPosition());
                return directoryEntrySector.subView(0, 128);
            } else {
                return this.sectors.sector(this.sectorChain[this.sectorChain.length - 1])
                    .subView(directoriesRegisteredInCurrentSector * DirectoryEntry.ENTRY_LENGTH, (directoriesRegisteredInCurrentSector + 1) * DirectoryEntry.ENTRY_LENGTH);
            }
        } finally {
            this.directoryEntryCount++;
        }
    }

}