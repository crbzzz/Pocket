#!/usr/bin/env python3
"""Generate the small, dependency-free app project; PocketCore is a local package."""
from pathlib import Path
from hashlib import sha1
root = Path(__file__).resolve().parents[1] / 'apps/ios'
project = root / 'Pocket.xcodeproj'
project.mkdir(exist_ok=True)
def uid(s): return sha1(s.encode()).hexdigest()[:24].upper()
files = sorted((root / 'Pocket').glob('*.swift'))
objects = []
def obj(key, value): objects.append(f'{uid(key)} = {{ {value} }};')
for f in files:
    obj(f.name, f'isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {f.name}; sourceTree = "<group>";')
    obj('build-'+f.name, f'isa = PBXBuildFile; fileRef = {uid(f.name)};')
obj('assets', 'isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = \"<group>\";')
obj('assets-build', f'isa = PBXBuildFile; fileRef = {uid("assets")};')
obj('info', 'isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>";')
obj('app', 'isa = PBXFileReference; explicitFileType = wrapper.application; path = Pocket.app; sourceTree = BUILT_PRODUCTS_DIR;')
obj('core-build', f'isa = PBXBuildFile; productRef = {uid("core-product")};')
obj('core-product', f'isa = XCSwiftPackageProductDependency; package = {uid("core-package")}; productName = PocketCore;')
obj('core-package', 'isa = XCLocalSwiftPackageReference; relativePath = PocketCore;')
obj('group', f'isa = PBXGroup; children = ({uid("sources-group")},{uid("products-group")}); sourceTree = "<group>";')
obj('sources-group', f'isa = PBXGroup; children = ({",".join(uid(f.name) for f in files)},{uid("info")},{uid("assets")}); path = Pocket; sourceTree = "<group>";')
obj('products-group', f'isa = PBXGroup; children = ({uid("app")}); name = Products; sourceTree = "<group>";')
obj('sources', f'isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ({",".join(uid("build-"+f.name) for f in files)}); runOnlyForDeploymentPostprocessing = 0;')
obj('frameworks', f'isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = ({uid("core-build")}); runOnlyForDeploymentPostprocessing = 0;')
obj('resources', f'isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ({uid("assets-build")}); runOnlyForDeploymentPostprocessing = 0;')
obj('target', f'isa = PBXNativeTarget; buildConfigurationList = {uid("target-config")}; buildPhases = ({uid("sources")},{uid("frameworks")},{uid("resources")}); buildRules = (); dependencies = (); name = Pocket; packageProductDependencies = ({uid("core-product")}); productName = Pocket; productReference = {uid("app")}; productType = "com.apple.product-type.application";')
obj('project', f'isa = PBXProject; attributes = {{ BuildIndependentTargetsInParallel = YES; LastUpgradeCheck = 2700; }}; buildConfigurationList = {uid("project-config")}; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en,Base); mainGroup = {uid("group")}; packageReferences = ({uid("core-package")}); productRefGroup = {uid("products-group")}; projectDirPath = ""; projectRoot = ""; targets = ({uid("target")});')
for group in ['target','project']:
    obj(group+'-config',f'isa = XCConfigurationList; buildConfigurations = ({uid(group+"-Debug")},{uid(group+"-Release")}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
    for mode in ['Debug','Release']:
        settings = 'SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 17.0; SWIFT_VERSION = 6.0; ALWAYS_SEARCH_USER_PATHS = NO;'
        if group=='target': settings += ' ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon; PRODUCT_BUNDLE_IDENTIFIER = app.pocket.ios; PRODUCT_NAME = "$(TARGET_NAME)"; INFOPLIST_FILE = Pocket/Info.plist; TARGETED_DEVICE_FAMILY = 1; CODE_SIGN_STYLE = Automatic; SUPABASE_URL = ""; SUPABASE_PUBLISHABLE_KEY = ""; ENABLE_PREVIEWS = YES;'
        settings += ' SWIFT_OPTIMIZATION_LEVEL = "-Onone"; DEBUG_INFORMATION_FORMAT = dwarf; SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;' if mode=='Debug' else ' SWIFT_OPTIMIZATION_LEVEL = "-O"; DEBUG_INFORMATION_FORMAT = "dwarf-with-dsym";'
        obj(group+'-'+mode,f'isa = XCBuildConfiguration; buildSettings = {{ {settings} }}; name = {mode};')
(project / 'project.pbxproj').write_text('// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 60; objects = {\n'+'\n'.join(objects)+'\n}; rootObject = '+uid('project')+'; }\n')
scheme = project / 'xcshareddata/xcschemes'
scheme.mkdir(parents=True,exist_ok=True)
(scheme/'Pocket.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2700" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid('target')}" BuildableName="Pocket.app" BlueprintName="Pocket" ReferencedContainer="container:Pocket.xcodeproj"/></BuildActionEntry></BuildActionEntries></BuildAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid('target')}" BuildableName="Pocket.app" BlueprintName="Pocket" ReferencedContainer="container:Pocket.xcodeproj"/></BuildableProductRunnable></LaunchAction><ProfileAction buildConfiguration="Release"/><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>''')
print(project)
